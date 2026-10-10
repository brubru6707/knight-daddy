"""Fine-tune FinBERT on our training split (fairer baseline than zero-shot FinBERT).

Settings fixed in advance (standard BERT fine-tuning, no search): ProsusAI/finbert with its own 3-way head,
train split of zeroshot/twitter-financial-news-sentiment (9,543 tweets), 3 epochs, lr 2e-5, batch 32, max length 128,
linear schedule with 10% warmup, seed 0. The final epoch is used; the validation split (our test set for every model)
is never used for any choice. Scored with common.metrics like every other model -> results/finbert-finetuned.json.
"""
import time
import numpy as np
import torch
from datasets import load_dataset
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup
from common import DATASET, metrics

torch.manual_seed(0); np.random.seed(0)
name = "ProsusAI/finbert"
tok = AutoTokenizer.from_pretrained(name)
model = AutoModelForSequenceClassification.from_pretrained(name).cuda()
to_fb = {0: 1, 1: 0, 2: 2}  # dataset (0 Bearish, 1 Bullish, 2 Neutral) -> FinBERT ids (0 positive, 1 negative, 2 neutral)
from_fb = {v: k for k, v in to_fb.items()}
assert model.config.id2label == {0: "positive", 1: "negative", 2: "neutral"}

ds = load_dataset(DATASET)
train, val = ds["train"], ds["validation"]
tr_text, tr_lab = list(train["text"]), list(train["label"])  # plain lists (datasets 5 returns lazy columns)
va_text, va_lab = list(val["text"]), list(val["label"])
EPOCHS, BS, LR = 3, 32, 2e-5
steps = EPOCHS * ((len(train) + BS - 1) // BS)
opt = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
sched = get_linear_schedule_with_warmup(opt, int(0.1 * steps), steps)
t0 = time.time()
for ep in range(EPOCHS):
    model.train()
    order = np.random.permutation(len(train))
    losses = []
    for i in range(0, len(order), BS):
        idx = order[i:i + BS]
        enc = tok([tr_text[j] for j in idx], padding=True, truncation=True, max_length=128, return_tensors="pt").to("cuda")
        labels = torch.tensor([to_fb[tr_lab[j]] for j in idx], device="cuda")
        with torch.autocast("cuda", dtype=torch.bfloat16):
            loss = model(**enc, labels=labels).loss
        loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
        losses.append(loss.item())
    print(f"epoch {ep + 1}: mean train loss {np.mean(losses):.4f}")
train_s = time.time() - t0

model.eval()
texts, preds = va_text, []
torch.cuda.synchronize(); t0 = time.time()
with torch.inference_mode():
    for i in range(0, len(texts), 64):
        enc = tok(texts[i:i + 64], padding=True, truncation=True, max_length=256, return_tensors="pt").to("cuda")
        preds += [from_fb[p] for p in model(**enc).logits.argmax(-1).tolist()]
torch.cuda.synchronize(); dt = time.time() - t0
metrics(va_lab, preds, "finbert-finetuned", len(texts), dt,
        {"batch_size": 64, "precision": "fp32 eval, bf16 autocast train", "gpu": torch.cuda.get_device_name(0),
         "train": {"epochs": EPOCHS, "lr": LR, "batch": BS, "seconds": round(train_s, 1), "examples": len(train)}})
import os, json
json.dump({"pred": preds, "label": list(va_lab)}, open(os.path.expanduser("~/scratch/poc1/finbert_finetuned_val_preds.json"), "w"))
