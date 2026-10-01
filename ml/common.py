from io import BytesIO

import requests
import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor
from transformers.utils import logging as hf_logging

DEBUG = False

MODEL_NAME = "google/siglip2-base-patch16-224"


if DEBUG:
    hf_logging.set_verbosity_info()
    hf_logging.enable_progress_bar()
else:
    hf_logging.set_verbosity_error()
    hf_logging.disable_progress_bar()


def get_iiif_url(image_id: str, size: int = 512) -> str:
    return (
        "https://iiif.nypl.org/iiif/3/" f"{image_id}/full/^!{size},{size}/0/default.jpg"
    )


def fetch_image(image_id: str, size: int = 512) -> Image.Image:
    url = get_iiif_url(image_id, size)

    response = requests.get(url, timeout=30)
    response.raise_for_status()

    return Image.open(BytesIO(response.content)).convert("RGB")


def load_model():
    processor = AutoProcessor.from_pretrained(MODEL_NAME)
    model = AutoModel.from_pretrained(MODEL_NAME)

    model.eval()

    return processor, model


def get_embedding_tensor(output) -> torch.Tensor:
    if isinstance(output, torch.Tensor):
        return output

    if hasattr(output, "pooler_output"):
        return output.pooler_output

    raise TypeError(f"unexpected model output type: {type(output)}")


def embed_image(
    image: Image.Image,
    processor,
    model,
) -> torch.Tensor:
    inputs = processor(
        images=image,
        return_tensors="pt",
    )

    with torch.inference_mode():
        output = model.get_image_features(**inputs)

    embedding = get_embedding_tensor(output)

    return torch.nn.functional.normalize(
        embedding,
        p=2,
        dim=-1,
    )


def embed_texts(
    texts: list[str],
    processor,
    model,
) -> torch.Tensor:
    inputs = processor(
        text=texts,
        padding="max_length",
        max_length=64,
        return_tensors="pt",
    )

    with torch.inference_mode():
        output = model.get_text_features(**inputs)

    embeddings = get_embedding_tensor(output)

    return torch.nn.functional.normalize(
        embeddings,
        p=2,
        dim=-1,
    )
