"""Serve SigLIP2 text embeddings over HTTP.

Run from the repository root:
    python -m uvicorn ml.embedding_service:app --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ml.common import (
    MODEL_NAME,
    embed_texts,
    get_device,
    load_model,
)


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]
    dimensions: int


@asynccontextmanager
async def lifespan(app: FastAPI):
    device = get_device()

    print(f"Using device: {device}")
    print(f"Loading {MODEL_NAME}...")

    processor, model = load_model(device)

    app.state.processor = processor
    app.state.model = model
    app.state.device = device

    print("Embedding service ready.")

    yield

    del app.state.processor
    del app.state.model


app = FastAPI(
    title="Cigarette Card Embedding Service",
    lifespan=lifespan,
)


@app.get("/health")
def health(request: Request):
    return {
        "status": "ok",
        "model": MODEL_NAME,
        "device": str(request.app.state.device),
    }


@app.post(
    "/embed",
    response_model=EmbedResponse,
)
def embed(
    body: EmbedRequest,
    request: Request,
) -> EmbedResponse:
    text = body.text.strip()

    if not text:
        raise HTTPException(
            status_code=400,
            detail="Text must not be empty.",
        )

    embedding = embed_texts(
        [text],
        request.app.state.processor,
        request.app.state.model,
    )[0]

    values = embedding.tolist()

    return EmbedResponse(
        embedding=values,
        dimensions=len(values),
    )
