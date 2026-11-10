"""Serve SigLIP2 text embeddings over HTTP.

Run from the repository root:
    python -m uvicorn ml.embedding_service:app --host 127.0.0.1 --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from ml.common import (
    MODEL_NAME,
    MODEL_REVISION,
    TextTooLongError,
    embed_texts,
    get_device,
    load_model,
)

MAX_TEXT_LENGTH = 500


def text_too_long() -> HTTPException:
    return HTTPException(
        status_code=400,
        detail={
            "code": "text_too_long",
            "message": "Description is too long. Try a shorter phrase.",
        },
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
        "revision": MODEL_REVISION,
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

    if len(text) > MAX_TEXT_LENGTH:
        raise text_too_long()

    try:
        embedding = embed_texts(
            [text],
            request.app.state.processor,
            request.app.state.model,
        )[0]
    except TextTooLongError as error:
        raise text_too_long() from error

    values = embedding.tolist()

    return EmbedResponse(
        embedding=values,
        dimensions=len(values),
    )
