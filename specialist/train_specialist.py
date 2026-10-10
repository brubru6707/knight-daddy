"""Fine-tune a per-ticker specialist from the general Qwen3.5-2B adapter (QLoRA), writing live progress.

Training data = 9B-teacher-labeled pre-2023-07 headlines for the ticker, mixed 50/50 with general
labeled tweets (replay, so the model keeps its general skill). Never uses hand labels or 2B labels.
Same prompt, Negative/Positive/Neutral targets, and logit scoring as train_qlora.py / classifier.py.
Inputs are padded to a fixed length so kernels compile for one shape only.

  python train_specialist.py --ticker NVDA --run_dir ~/scratch/poc1/specialists/NVDA/run1
  python train_specialist.py --general_only --max_steps 20 --run_dir /tmp/x   # timing test, no teacher labels
Progress: <run_dir>/progress.json (atomic writes): phase, step, total_steps, losses, elapsed_s, eta_s, timings.
"""
import argparse, json, os, sys, time
import pandas as pd
import torch

sys.path.insert(0, os.path.expanduser("~/poc1/terminal/backend"))
from classifier import SYSTEM, TARGETS  # noqa: E402

LABEL_ID = {"Bearish": 0, "Bullish": 1, "Neutral": 2}
p = argparse.ArgumentParser()
p.add_argument("--ticker", default=None)
p.add_argument("--run_dir", required=True)
p.add_argument("--base", default="Qwen/Qwen3.5-2B")
p.add_argument("--init_adapter", default=os.path.expanduser("~/poc1/adapters/qwen35-2b"))
p.add_argument("--data_dir", default="/oscar/scratch/brrodrig/poc1/specialist")
p.add_argument("--max_ticker", type=int, default=600, help="cap on ticker examples (time budget)")
p.add_argument("--replay_ratio", type=float, default=1.0, help="general examples per ticker example")
p.add_argument("--bs", type=int, default=16)
p.add_argument("--lr", type=float, default=5e-5)
p.add_argument("--pad_len", type=int, default=128)
p.add_argument("--max_steps", type=int, default=None)
p.add_argument("--general_only", action="store_true", help="timing test without teacher labels")
p.add_argument("--seed", type=int, default=0)
p.add_argument("--no_save", action="store_true", help="warmup: do not save the adapter")
p.add_argument("--standby", action="store_true",
               help="import libraries and load the model now, then wait for the real arguments as one JSON list on stdin "
                    "(keeps the model resident so a quick demo run starts at once)")
p.add_argument("--quick", action="store_true",
               help="QUICK DEMO RUN, not scored: 64 ticker + 64 general examples, 64-row scoring pools, cached 'before' scores")
args = p.parse_args()
PRE = None
if args.standby:
    _t = time.time()
    from peft import PeftModel, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    def _load(a):
        tok = AutoTokenizer.from_pretrained(a.init_adapter)
        bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                                 bnb_4bit_compute_dtype=torch.bfloat16)
        m = AutoModelForCausalLM.from_pretrained(a.base, quantization_config=bnb, dtype=torch.bfloat16, device_map={"": 0})
        m = prepare_model_for_kbit_training(m, use_gradient_checkpointing=True,
                                            gradient_checkpointing_kwargs={"use_reentrant": False})
        return PeftModel.from_pretrained(m, a.init_adapter, is_trainable=True), tok
    base_args = (args.base, args.init_adapter)
    PRE = _load(args)
    print(f"standby ready in {time.time() - _t:.1f}s", flush=True)
    line = sys.stdin.readline()
    if not line.strip():
        sys.exit(0)
    args = p.parse_args(json.loads(line))
    if (args.base, args.init_adapter) != base_args:  # different model requested: do not reuse the preloaded one
        PRE = None
if args.quick:
    args.max_ticker = min(args.max_ticker, 64)
QUICK_POOL = 64
os.makedirs(args.run_dir, exist_ok=True)
T0 = time.time()
state = {"ticker": args.ticker, "quick": args.quick, "phase": "starting", "step": 0, "total_steps": None, "losses": [],
         "loss_ticker": [], "loss_general": [], "probe": [],
         "elapsed_s": 0, "eta_s": None, "timings": {}, "error": None, "config": vars(args)}


def save_progress(**kw):
    state.update(kw, elapsed_s=round(time.time() - T0, 1))
    tmp = os.path.join(args.run_dir, "progress.json.tmp")
    with open(tmp, "w") as f:
        json.dump(state, f)
    os.replace(tmp, os.path.join(args.run_dir, "progress.json"))


try:
    save_progress(phase="loading data")
    gen_cache = os.path.join(args.data_dir, "_general_train.parquet")
    if os.path.exists(gen_cache):  # same rows as the HF dataset's train split, saved once (skips datasets startup)
        gen = pd.read_parquet(gen_cache)
    else:
        from datasets import load_dataset
        gen = load_dataset("zeroshot/twitter-financial-news-sentiment")["train"].to_pandas()
        gen = gen.rename(columns={"label": "y"})[["text", "y"]].assign(src=0)
        gen.to_parquet(gen_cache)
    probe, gold, held = None, None, None
    if args.general_only:
        data = gen.sample(n=args.bs * (args.max_steps or 20), random_state=args.seed)
        n_ticker = 0
    else:
        tk = pd.read_parquet(f"{args.data_dir}/{args.ticker}_train_teacher.parquet")
        tk = tk.assign(y=tk.label.map(LABEL_ID), src=1)[["text", "y", "src"]]
        held_f = f"{args.data_dir}/{args.ticker}_heldout_teacher.parquet"
        if os.path.exists(held_f) and len(pd.read_parquet(held_f)):
            held = pd.read_parquet(held_f)
            probe = held.sample(n=min(32 if args.quick else 64, len(held)), random_state=args.seed)
            state["probe_source"] = ("held-out posts, never trained on" if args.ticker == "CRYPTO"
                                     else "Jul-Dec 2023 headlines, never trained on")
        else:  # no held-out pool (DDOG): carve the probe out of the training pool
            probe = tk.sample(n=min(32, len(tk) // 10), random_state=args.seed)
            state["probe_source"] = "same pre-Jul 2023 pool as training, held out (weaker test)"
            tk = tk.drop(probe.index)
        probe = probe.assign(y=probe["label"].map(LABEL_ID) if "label" in probe else probe.y)
        gold = pd.read_parquet(f"{args.data_dir}/{args.ticker}_gold_teacher.parquet")
        tk = tk.sample(n=min(args.max_ticker, len(tk)), random_state=args.seed)
        rep = gen.sample(n=int(len(tk) * args.replay_ratio), random_state=args.seed)
        data = pd.concat([tk, rep]).sample(frac=1, random_state=args.seed)
        n_ticker = len(tk)
    steps = -(-len(data) // args.bs)
    if args.max_steps:
        steps = min(steps, args.max_steps)
    state["timings"]["data_s"] = round(time.time() - T0, 1)
    save_progress(phase="loading model", total_steps=steps,
                  data={"ticker_examples": n_ticker, "general_examples": len(data) - n_ticker})

    t = time.time()
    if PRE is not None:  # standby process: libraries imported and model loaded before the click
        model, tok = PRE
        state["timings"]["import_s"] = state["timings"]["load_s"] = 0.0
        state["preloaded"] = True
    else:
        from peft import PeftModel, prepare_model_for_kbit_training
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
        state["timings"]["import_s"] = round(time.time() - t, 1)
        t = time.time()
        tok = AutoTokenizer.from_pretrained(args.init_adapter)
        bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
                                 bnb_4bit_compute_dtype=torch.bfloat16)
        model = AutoModelForCausalLM.from_pretrained(args.base, quantization_config=bnb, dtype=torch.bfloat16,
                                                     device_map={"": 0})
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True,
                                                gradient_checkpointing_kwargs={"use_reentrant": False})
        model = PeftModel.from_pretrained(model, args.init_adapter, is_trainable=True)
        state["timings"]["load_s"] = round(time.time() - t, 1)
    model.train()

    end = "<|im_end|>"

    def encode(text, y):
        msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]
        pr = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)
        pi = tok(pr, add_special_tokens=False).input_ids
        ti = tok(TARGETS[y] + end, add_special_tokens=False).input_ids
        pi = pi[: args.pad_len - len(ti)]
        ids, lab = pi + ti, [-100] * len(pi) + ti
        pad = args.pad_len - len(ids)  # fixed shape: right-pad every example to pad_len
        return ids + [tok.pad_token_id] * pad, lab + [-100] * pad, [1] * len(ids) + [0] * pad

    t = time.time()
    enc = [encode(r.text, int(r.y)) for r in data.itertuples()]
    state["timings"]["encode_s"] = round(time.time() - t, 1)
    srcs = data.src.tolist()
    ce = torch.nn.CrossEntropyLoss(reduction="none")

    def example_losses(ids, att, lab):
        """Per-example mean token loss on the target tokens (same quantity HF's .loss averages)."""
        logits = model(input_ids=ids, attention_mask=att).logits[:, :-1]
        tgt = lab[:, 1:]
        m = tgt != -100
        tok_loss = torch.zeros_like(tgt, dtype=torch.float32)
        tok_loss[m] = ce(logits[m].float(), tgt[m])
        return tok_loss, m

    probe_enc = [encode(r.text, int(r.y)) for r in probe.itertuples()] if probe is not None else []

    @torch.no_grad()
    def probe_loss():
        model.eval()
        tot, cnt = 0.0, 0
        for i in range(0, len(probe_enc), 32):
            ids, lab, att = (torch.tensor(x, device="cuda") for x in zip(*probe_enc[i:i + 32]))
            with torch.autocast("cuda", dtype=torch.bfloat16):
                tl, m = example_losses(ids, att, lab)
            tot += tl[m].sum().item(); cnt += m.sum().item()
        model.train()
        return round(tot / cnt, 4)

    label_ids = [tok(x, add_special_tokens=False).input_ids[0] for x in TARGETS]

    @torch.inference_mode()
    def predict(texts, bs=32):
        """Same scoring as the dashboard classifier; left-padded to one fixed length (one kernel shape)."""
        model.eval()
        tok.padding_side, tok.truncation_side = "left", "left"
        out = []
        for i in range(0, len(texts), bs):
            prompts = [tok.apply_chat_template([{"role": "system", "content": SYSTEM}, {"role": "user", "content": x}],
                                               tokenize=False, add_generation_prompt=True, enable_thinking=False)
                       for x in texts[i:i + bs]]
            e = tok(prompts, return_tensors="pt", padding="max_length", max_length=args.pad_len, truncation=True,
                    add_special_tokens=False).to("cuda")
            with torch.autocast("cuda", dtype=torch.bfloat16):
                pr = model(**e, logits_to_keep=1).logits[:, -1, label_ids].float().softmax(-1)
            out.append(pr.cpu())
        model.train()
        return torch.cat(out).numpy()

    NAMES = ["Bearish", "Bullish", "Neutral"]

    def score_pools(tag):
        for name, df in (("gold", gold), ("heldout", held)):
            if df is None:
                continue
            if tag == "general":  # "before" scores depend only on the fixed general adapter: compute once, reuse
                cache = os.path.join(args.data_dir, f"{args.ticker}_general_preds_{name}.parquet")
                if os.path.exists(cache):
                    c = pd.read_parquet(cache)
                    if len(c) == len(df) and (c.text.values == df.text.values).all():
                        for col in c.columns.drop("text"):
                            preds[name][col] = c[col].values
                        continue
                pr = predict(df.text.tolist())
                cols = {"general_label": [NAMES[k] for k in pr.argmax(1)],
                        **{f"general_{c}": pr[:, j] for j, c in enumerate(["p_bear", "p_bull", "p_neut"])}}
                pd.DataFrame({"text": df.text.values, **cols}).to_parquet(cache)
                for col, v in cols.items():
                    preds[name][col] = v
                continue
            pr = predict(df.text.tolist())
            preds[name][f"{tag}_label"] = [NAMES[k] for k in pr.argmax(1)]
            for j, c in enumerate(["p_bear", "p_bull", "p_neut"]):
                preds[name][f"{tag}_{c}"] = pr[:, j]

    preds = {}
    if gold is not None:
        preds["gold"] = gold[["id", "date", "text", "label"]].rename(columns={"label": "teacher_label"}).reset_index(drop=True)
        if held is not None:
            preds["heldout"] = held[["date", "text", "label"]].rename(columns={"label": "teacher_label"}).reset_index(drop=True)
        save_progress(phase="scoring general model")
        t = time.time(); score_pools("general"); state["timings"]["score_general_s"] = round(time.time() - t, 1)
        if args.quick:  # small fixed subsets (same rows every quick run); the cached "before" scores travel with them
            for name in list(preds):
                keep = preds[name].sample(n=min(QUICK_POOL, len(preds[name])), random_state=args.seed).index
                preds[name] = preds[name].loc[keep].reset_index(drop=True)
            gold = preds["gold"][["text"]]
            held = preds["heldout"][["text"]] if "heldout" in preds else None
    if probe_enc:
        t = time.time(); state["probe"].append([0, probe_loss()]); state["timings"]["probe0_s"] = round(time.time() - t, 1)
    opt = torch.optim.AdamW([q for q in model.parameters() if q.requires_grad], lr=args.lr, weight_decay=0.0)
    sched = torch.optim.lr_scheduler.LambdaLR(opt, lambda s: min(1.0, (s + 1) / max(1, steps // 10)) * max(0.0, 1 - s / steps))
    save_progress(phase="training")
    step_times = []
    for s in range(steps):
        b = enc[s * args.bs:(s + 1) * args.bs]
        ids, lab, att = (torch.tensor(x, device="cuda") for x in zip(*b))
        t = time.time()
        with torch.autocast("cuda", dtype=torch.bfloat16):
            tl, m = example_losses(ids, att, lab)
            loss = tl[m].sum() / m.sum()
        loss.backward()
        torch.nn.utils.clip_grad_norm_([q for q in model.parameters() if q.requires_grad], 1.0)
        opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
        torch.cuda.synchronize()
        step_times.append(time.time() - t)
        if s == 0:
            state["timings"]["first_step_s"] = round(step_times[0], 1)
        steady = sum(step_times[1:]) / max(1, len(step_times) - 1) if len(step_times) > 1 else step_times[0]
        state["losses"].append(round(loss.item(), 4))
        ex = (tl.sum(1) / m.sum(1).clamp(min=1)).detach().cpu().tolist()
        bsrc = srcs[s * args.bs:(s + 1) * args.bs]
        for key, flag in (("loss_ticker", 1), ("loss_general", 0)):
            v = [x for x, f in zip(ex, bsrc) if f == flag]
            state[key].append(round(sum(v) / len(v), 4) if v else None)
        if probe_enc and ((s + 1) % (4 if args.quick else 5) == 0 or s + 1 == steps):
            state["probe"].append([s + 1, probe_loss()])
        save_progress(step=s + 1, eta_s=round(steady * (steps - s - 1), 1))
    if args.general_only:  # warmup also compiles the fixed-shape inference kernels used for scoring
        t = time.time(); predict(data.text.tolist()[:64]); state["timings"]["warmup_predict_s"] = round(time.time() - t, 1)
    state["timings"]["steady_step_s"] = round(sum(step_times[1:]) / max(1, len(step_times) - 1), 3)
    state["timings"]["train_s"] = round(sum(step_times), 1)
    state["timings"]["peak_mem_gib"] = round(torch.cuda.max_memory_allocated() / 2**30, 2)
    if preds:
        save_progress(phase="scoring specialist")
        t = time.time(); score_pools("specialist"); state["timings"]["score_specialist_s"] = round(time.time() - t, 1)
        for name, df in preds.items():
            df.to_parquet(os.path.join(args.run_dir, f"preds_{name}.parquet"))
        if "heldout" in preds:  # agreement with the 9B teacher: NOT accuracy (no human labels involved)
            h = preds["heldout"]
            state["agreement_with_teacher"] = {
                "n": len(h), "pool": ("held-out posts (author tags)" if args.ticker == "CRYPTO"
                                      else "Jul-Dec 2023 held-out headlines (9B labels)"),
                "general": round(float((h.general_label == h.teacher_label).mean()), 4),
                "specialist": round(float((h.specialist_label == h.teacher_label).mean()), 4)}
        g = preds["gold"]
        state["changed_on_test_rows"] = int((g.general_label != g.specialist_label).sum())
    out = None
    if not args.no_save:
        save_progress(phase="saving")
        out = os.path.join(args.run_dir, "adapter")
        t = time.time(); model.save_pretrained(out); tok.save_pretrained(out)
        state["timings"]["save_s"] = round(time.time() - t, 1)
    save_progress(phase="done", adapter=out)
    print(json.dumps({k: state[k] for k in ["phase", "step", "total_steps", "timings", "elapsed_s"]}, indent=1))
    print("losses:", state["losses"])
except Exception as e:  # surface failures to the UI instead of dying silently
    save_progress(phase="failed", error=f"{type(e).__name__}: {e}")
    raise
