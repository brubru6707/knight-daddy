"""Deploy the /classify endpoint to Modal (Oscar is not publicly reachable).

NOT YET DEPLOYED OR TESTED (written 2026-10-09, no Modal account set up on Oscar).

One-time setup on a machine with internet:
    pip install modal && modal setup
    modal volume create knightwatch-adapter
    modal volume put knightwatch-adapter ~/poc1/adapters/qwen35-2b /qwen35-2b
    modal secret create knightwatch-auth MODEL_ENDPOINT_TOKEN=<pick a long random string>
Deploy:
    modal deploy backend/modal_app.py
Then put the printed URL and the same token in terminal/.env:
    MODEL_ENDPOINT_URL=https://<workspace>--knightwatch-classifier-api.modal.run
    MODEL_ENDPOINT_TOKEN=<same string>
The FastAPI backend then POSTs {"texts": [...]} to $MODEL_ENDPOINT_URL/classify.
"""
import os

import modal

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.11.0", "transformers==5.19.0", "peft==0.21.2", "bitsandbytes==0.50.2",
                 "accelerate==1.15.0", "flash-linear-attention==0.5.2", "fastapi", "pydantic")
    .add_local_file(os.path.join(os.path.dirname(__file__), "classifier.py"), "/root/classifier.py")
)
# causal-conv1d needs a CUDA toolchain to build; without it Qwen3.5 falls back to a slower torch path.
adapter_vol = modal.Volume.from_name("knightwatch-adapter")
hf_cache = modal.Volume.from_name("knightwatch-hf-cache", create_if_missing=True)
app = modal.App("knightwatch-classifier")


@app.cls(image=image, gpu="A10G", volumes={"/adapter": adapter_vol, "/hf": hf_cache},
         secrets=[modal.Secret.from_name("knightwatch-auth")], env={"HF_HOME": "/hf"},
         scaledown_window=300)
class Classifier:
    @modal.enter()
    def load(self):
        from classifier import SentimentModel
        self.model = SentimentModel("/adapter/qwen35-2b")
        self.model.load()

    @modal.asgi_app()
    def api(self):
        from fastapi import FastAPI, Header, HTTPException
        from pydantic import BaseModel

        web = FastAPI()

        class In(BaseModel):
            texts: list[str]

        @web.post("/classify")
        def classify(body: In, authorization: str = Header(default="")):
            if authorization != f"Bearer {os.environ['MODEL_ENDPOINT_TOKEN']}":
                raise HTTPException(401, "bad token")
            if not body.texts or len(body.texts) > 256:
                raise HTTPException(400, "send 1 to 256 texts")
            return {"results": self.model.classify(body.texts)}

        @web.get("/health")
        def health():
            return {"ok": True}

        return web
