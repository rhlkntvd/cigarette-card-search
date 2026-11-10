from io import BytesIO

import requests
import torch
from PIL import Image
from requests.adapters import HTTPAdapter
from transformers import AutoModel, AutoProcessor
from transformers.utils import logging as hf_logging
from urllib3.util.retry import Retry

MODEL_NAME = "google/siglip2-base-patch16-224"
MODEL_REVISION = "75de2d55ec2d0b4efc50b3e9ad70dba96a7b2fa2"
TEXT_MAX_TOKENS = 64

hf_logging.set_verbosity_error()
hf_logging.disable_progress_bar()


class TextTooLongError(ValueError):
    """Text exceeds the encoder's token limit."""


def get_device() -> torch.device:
    if torch.cuda.is_available():
        return torch.device("cuda")

    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return torch.device("mps")

    return torch.device("cpu")


def create_http_session() -> requests.Session:
    retry_policy = Retry(
        total=3,
        connect=3,
        read=3,
        status=3,
        backoff_factor=0.5,
        status_forcelist=[
            429,
            500,
            502,
            503,
            504,
        ],
        allowed_methods=["GET"],
    )

    adapter = HTTPAdapter(
        max_retries=retry_policy,
    )

    session = requests.Session()

    session.mount(
        "https://",
        adapter,
    )

    session.mount(
        "http://",
        adapter,
    )

    return session


def get_iiif_url(
    image_id: str,
    size: int = 512,
) -> str:
    return (
        "https://iiif.nypl.org/iiif/3/" f"{image_id}/full/^!{size},{size}/0/default.jpg"
    )


def fetch_image(
    image_id: str,
    size: int = 512,
    session: requests.Session | None = None,
) -> Image.Image:
    url = get_iiif_url(
        image_id,
        size,
    )

    client = session or requests

    response = client.get(
        url,
        timeout=30,
    )

    response.raise_for_status()

    return Image.open(BytesIO(response.content)).convert("RGB")


def load_model(
    device: torch.device | None = None,
):
    processor = AutoProcessor.from_pretrained(
        MODEL_NAME,
        revision=MODEL_REVISION,
    )

    model = AutoModel.from_pretrained(
        MODEL_NAME,
        revision=MODEL_REVISION,
    )

    model.eval()

    if device is not None:
        model.to(device)

    return processor, model


def get_embedding_tensor(
    output,
    expected_count: int,
) -> torch.Tensor:
    if isinstance(output, torch.Tensor):
        embeddings = output
    elif hasattr(output, "pooler_output"):
        embeddings = output.pooler_output
    else:
        raise TypeError(f"Unexpected model output type: {type(output)}")

    if not isinstance(embeddings, torch.Tensor):
        raise TypeError("Model output did not contain an embedding tensor")

    # Check before pairing vectors with metadata, so no items are silently lost.
    if embeddings.ndim != 2 or embeddings.shape[0] != expected_count:
        raise ValueError(
            f"Expected {expected_count} embedding rows in a 2D tensor, "
            f"got shape {tuple(embeddings.shape)}"
        )

    return embeddings


def get_model_device(
    model,
) -> torch.device:
    return next(model.parameters()).device


def embed_images(
    images: list[Image.Image],
    processor,
    model,
) -> torch.Tensor:
    inputs = processor(
        images=images,
        return_tensors="pt",
    )

    device = get_model_device(model)

    inputs = {key: value.to(device) for key, value in inputs.items()}

    with torch.inference_mode():
        output = model.get_image_features(
            **inputs,
        )

    embeddings = get_embedding_tensor(
        output,
        expected_count=len(images),
    )

    embeddings = torch.nn.functional.normalize(
        embeddings,
        p=2,
        dim=-1,
    )

    return embeddings.cpu()


def embed_image(
    image: Image.Image,
    processor,
    model,
) -> torch.Tensor:
    return embed_images(
        [image],
        processor,
        model,
    )


def embed_texts(
    texts: list[str],
    processor,
    model,
) -> torch.Tensor:
    inputs = processor(
        text=texts,
        padding="max_length",
        max_length=TEXT_MAX_TOKENS,
        truncation=False,
        return_tensors=None,
    )

    # Check untruncated IDs before tensor conversion, including mixed-length batches.
    if any(len(ids) > TEXT_MAX_TOKENS for ids in inputs["input_ids"]):
        raise TextTooLongError(f"Text exceeds {TEXT_MAX_TOKENS} tokens")

    inputs = inputs.convert_to_tensors("pt")

    device = get_model_device(model)

    inputs = {key: value.to(device) for key, value in inputs.items()}

    with torch.inference_mode():
        output = model.get_text_features(
            **inputs,
        )

    embeddings = get_embedding_tensor(
        output,
        expected_count=len(texts),
    )

    embeddings = torch.nn.functional.normalize(
        embeddings,
        p=2,
        dim=-1,
    )

    return embeddings.cpu()
