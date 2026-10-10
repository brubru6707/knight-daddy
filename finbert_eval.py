import time, torch
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from common import metrics, DATASET, LABELS

ds = load_dataset(DATASET)["validation"]
for lab in range(3):  # sanity check of dataset label meaning
    print(LABELS[lab], "|", [t[:70] for t in ds.filter(lambda e: e["label"] == lab)["text"][:3]])

name = "ProsusAI/finbert"
tok = AutoTokenizer.from_pretrained(name)
model = AutoModelForSequenceClassification.from_pretrained(name).cuda().eval()
id2label = model.config.id2label  # {0:positive,1:negative,2:neutral}
to_ds = {"negative": 0, "positive": 1, "neutral": 2}
fmap = {i: to_ds[l] for i, l in id2label.items()}
print("finbert->dataset map:", {id2label[i]: LABELS[j] for i, j in fmap.items()})

texts, preds = ds["text"], []
torch.cuda.synchronize(); t0 = time.time()
with torch.inference_mode():
    for i in range(0, len(texts), 64):
        enc = tok(texts[i:i+64], padding=True, truncation=True, max_length=256, return_tensors="pt").to("cuda")
        preds += [fmap[p] for p in model(**enc).logits.argmax(-1).tolist()]
torch.cuda.synchronize(); dt = time.time() - t0
metrics(ds["label"], preds, name, len(texts), dt, {"batch_size": 64, "precision": "fp32", "gpu": torch.cuda.get_device_name(0)})
