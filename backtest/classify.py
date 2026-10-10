"""Classify each ticker's in-window, name-matched headlines with the Qwen3.5-2B QLoRA adapter.

Prompt and scoring are identical to ~/poc1/train_qlora.py (chat template, thinking off,
softmax over the Negative/Positive/Neutral answer tokens). Output: one row per headline.
"""
import os, sys, time
import pandas as pd, torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

C = "/oscar/scratch/brrodrig/poc1/backtest"
ADAPTER = os.path.expanduser("~/poc1/adapters/qwen35-2b")
BASE = "Qwen/Qwen3.5-2B"
START, END = "2022-12-15", "2023-12-14"  # headline UTC dates that can drive trades 2022-12-16 .. 2023-12-15
NAMES = {"NVDA": r"nvidia|nvda", "DDOG": r"datadog|ddog"}
SYSTEM = ("Classify the sentiment of the financial news tweet for investors. "
          "Answer with exactly one word: Negative (bearish), Positive (bullish), or Neutral.")
TARGETS = ["Negative", "Positive", "Neutral"]  # -> Bearish, Bullish, Neutral

tok = AutoTokenizer.from_pretrained(ADAPTER)
tok.padding_side = "left"
ids = [tok(t, add_special_tokens=False).input_ids[0] for t in TARGETS]
bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4",
                         bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=torch.bfloat16)
model = AutoModelForCausalLM.from_pretrained(BASE, quantization_config=bnb, dtype=torch.bfloat16,
                                             device_map={"": 0})
model = PeftModel.from_pretrained(model, ADAPTER).eval()


def prompt(text):
    msgs = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": text}]
    return tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True, enable_thinking=False)


@torch.inference_mode()
def probs(texts, bs=32):
    out = []
    for i in range(0, len(texts), bs):
        enc = tok([prompt(t) for t in texts[i:i + bs]], return_tensors="pt", padding=True,
                  pad_to_multiple_of=16, add_special_tokens=False).to("cuda")
        out.append(model(**enc, logits_to_keep=1).logits[:, -1, ids].float().softmax(-1).cpu())
    return torch.cat(out).numpy()


# sanity check on obvious headlines before trusting it on real data
demo = ["Nvidia shares plunge after guidance cut and SEC probe",
        "Nvidia beats estimates and raises outlook, stock soars",
        "Nvidia to present at investor conference on Tuesday"]
for t, p in zip(demo, probs(demo)):
    print(f"  {dict(zip(['bear', 'bull', 'neut'], p.round(3)))}  {t}")

for t in sys.argv[1:] or list(NAMES):
    df = pd.read_parquet(f"{C}/news_{t}_nasdaq.parquet")
    df["date_utc"] = df.ts.dt.tz_convert("UTC").dt.date.astype(str)
    df = df[(df.date_utc >= START) & (df.date_utc <= END)]
    df = df[df.Article_title.str.contains(NAMES[t], case=False, regex=True)].reset_index(drop=True)
    t0 = time.time()
    p = probs(df.Article_title.tolist())
    df["p_bear"], df["p_bull"], df["p_neut"] = p[:, 0], p[:, 1], p[:, 2]
    df["label"] = pd.Series(p.argmax(1)).map({0: "Bearish", 1: "Bullish", 2: "Neutral"})
    df.to_parquet(f"{C}/sentiment_{t}.parquet")
    print(f"{t}: {len(df)} headlines in {time.time() - t0:.0f}s, labels {df.label.value_counts().to_dict()}")
    for lab in ["Bearish", "Bullish"]:
        print(f"  top {lab}:", df[df.label == lab].Article_title.head(3).tolist())
