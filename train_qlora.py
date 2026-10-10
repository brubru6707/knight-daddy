"""QLoRA fine-tune a decoder LM as a 3-way financial tweet sentiment classifier.

Prompt = chat template (thinking disabled) with the tweet; target = one label word.
Eval = constrained scoring: compare next-token logits of the three label words'
first tokens at the answer position (no free-form generation, no parse failures).

Usage:
  python train_qlora.py --model Qwen/Qwen3.5-2B --out ~/scratch/poc1/qwen35-2b
  python train_qlora.py --model Qwen/Qwen3.5-9B --out ~/scratch/poc1/qwen35-9b  # batch job
  add --max_train 256 --max_eval 200 for a smoke test; --eval_base to score the untrained model.
Re-running with the same --out resumes from the latest checkpoint.
"""
import argparse, glob, math, os, shutil, time
import torch
from datasets import load_dataset
from peft import LoraConfig, PeftModel, get_peft_model, prepare_model_for_kbit_training
from transformers import (AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,
                          Trainer, TrainingArguments)
from common import DATASET, LABELS, metrics

SYSTEM = ("Classify the sentiment of the financial news tweet for investors. "
          "Answer with exactly one word: Negative (bearish), Positive (bullish), or Neutral.")
# target words indexed by dataset label id (0 Bearish, 1 Bullish, 2 Neutral); each is a
# single Qwen token, so eval scores exactly one token per class. Bullish -> 'B','ull','ish'.
TARGETS = ["Negative", "Positive", "Neutral"]

p = argparse.ArgumentParser()
p.add_argument("--model", default="Qwen/Qwen3.5-2B")
p.add_argument("--out", default=os.path.expanduser("~/scratch/poc1/qwen35-2b"))
p.add_argument("--adapter_copy", default=os.path.expanduser("~/poc1/adapters"))
p.add_argument("--max_len", type=int, default=256)
p.add_argument("--bs", type=int, default=16)
p.add_argument("--grad_accum", type=int, default=1)
p.add_argument("--lr", type=float, default=2e-4)
p.add_argument("--epochs", type=float, default=1.0)
p.add_argument("--r", type=int, default=16)
p.add_argument("--max_train", type=int, default=None)
p.add_argument("--max_eval", type=int, default=None)
p.add_argument("--eval_bs", type=int, default=32)
p.add_argument("--save_steps", type=int, default=100)
p.add_argument("--eval_base", action="store_true")
p.add_argument("--skip_train", action="store_true")
args = p.parse_args()
tag = os.path.basename(args.out.rstrip("/"))

tok = AutoTokenizer.from_pretrained(args.model)
tok.padding_side = "left"
if tok.pad_token is None:
    tok.pad_token = tok.eos_token


def prompt(text):
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True,
                                   enable_thinking=False)


end = tok.eos_token if "<|im_end|>" not in tok.get_vocab() else "<|im_end|>"
label_first_ids = [tok(l, add_special_tokens=False).input_ids[0] for l in TARGETS]
assert len(set(label_first_ids)) == 3, f"label first tokens collide: {label_first_ids}"
print("prompt example:\n" + prompt("$XYZ beats estimates") + TARGETS[1] + end)
print("label first-token ids:", dict(zip(TARGETS, label_first_ids)),
      [tok.decode([i]) for i in label_first_ids])

ds = load_dataset(DATASET)
train, val = ds["train"].shuffle(seed=0), ds["validation"]
if args.max_train: train = train.select(range(args.max_train))
if args.max_eval: val = val.select(range(args.max_eval))


def encode(ex):
    pi = tok(prompt(ex["text"]), add_special_tokens=False).input_ids
    ti = tok(TARGETS[ex["label"]] + end, add_special_tokens=False).input_ids
    pi = pi[: args.max_len - len(ti)]
    return {"input_ids": pi + ti, "labels": [-100] * len(pi) + ti}


def collate(batch):
    n = -(-max(len(b["input_ids"]) for b in batch) // 32) * 32  # pad to multiple of 32: fewer triton recompiles
    ids = torch.full((len(batch), n), tok.pad_token_id)
    lab = torch.full((len(batch), n), -100)
    att = torch.zeros((len(batch), n), dtype=torch.long)
    for i, b in enumerate(batch):  # right-pad for training
        L = len(b["input_ids"])
        ids[i, :L], lab[i, :L], att[i, :L] = torch.tensor(b["input_ids"]), torch.tensor(b["labels"]), 1
    return {"input_ids": ids, "labels": lab, "attention_mask": att}


bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                         bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
model = AutoModelForCausalLM.from_pretrained(args.model, quantization_config=bnb,
                                             dtype=torch.bfloat16, device_map={"": 0})
print("loaded", type(model).__name__, f"{torch.cuda.memory_allocated()/2**30:.2f} GiB")


@torch.inference_mode()
def evaluate(m, name):
    m.eval()
    texts = [prompt(t) for t in val["text"]]
    order = sorted(range(len(texts)), key=lambda i: len(texts[i]))  # fewer distinct shapes
    preds = [None] * len(texts)

    def run(idx):
        enc = tok([texts[i] for i in idx], return_tensors="pt", padding=True,
                  pad_to_multiple_of=16, add_special_tokens=False).to("cuda")
        return m(**enc, logits_to_keep=1).logits[:, -1, label_first_ids].argmax(-1).tolist()

    run(order[:args.eval_bs])  # untimed warmup (triton autotune / compile)
    torch.cuda.synchronize(); t0 = time.time()
    for i in range(0, len(order), args.eval_bs):
        idx = order[i:i + args.eval_bs]
        for j, pr in zip(idx, run(idx)): preds[j] = pr
    torch.cuda.synchronize(); dt = time.time() - t0
    return metrics(val["label"], preds, name, len(texts), dt,
                   {"eval_bs": args.eval_bs, "quant": "nf4", "gpu": torch.cuda.get_device_name(0)})


if args.eval_base:
    evaluate(model, f"{tag}-base-zeroshot")

model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True,
                                        gradient_checkpointing_kwargs={"use_reentrant": False})
final_dir = os.path.join(args.out, "final_adapter")
if args.skip_train:
    model = PeftModel.from_pretrained(model, final_dir)
else:
    model = get_peft_model(model, LoraConfig(r=args.r, lora_alpha=2 * args.r, lora_dropout=0.05,
                                             target_modules="all-linear", task_type="CAUSAL_LM"))
    model.print_trainable_parameters()
    tr = train.map(encode, remove_columns=train.column_names)
    total_steps = math.ceil(len(tr) / (args.bs * args.grad_accum) * args.epochs)
    targs = TrainingArguments(
        output_dir=args.out, per_device_train_batch_size=args.bs,
        gradient_accumulation_steps=args.grad_accum, num_train_epochs=args.epochs,
        learning_rate=args.lr, lr_scheduler_type="cosine", warmup_steps=max(1, int(0.03 * total_steps)),
        bf16=True, optim="paged_adamw_8bit", logging_steps=10,
        save_strategy="steps", save_steps=args.save_steps, save_total_limit=2,
        gradient_checkpointing=True, gradient_checkpointing_kwargs={"use_reentrant": False},
        report_to="none", remove_unused_columns=False,
        dataloader_num_workers=2, seed=0)
    trainer = Trainer(model=model, args=targs, train_dataset=tr, data_collator=collate)
    resume = bool(glob.glob(os.path.join(args.out, "checkpoint-*")))
    print("resume from checkpoint:", resume)
    t0 = time.time()
    trainer.train(resume_from_checkpoint=resume or None)
    print(f"train time {time.time()-t0:.0f}s, peak mem {torch.cuda.max_memory_allocated()/2**30:.2f} GiB")
    model.save_pretrained(final_dir); tok.save_pretrained(final_dir)
    if args.adapter_copy:
        dst = os.path.join(args.adapter_copy, tag)
        shutil.copytree(final_dir, dst, dirs_exist_ok=True)
        print("adapter copied to", dst)

evaluate(model, f"{tag}-qlora")
