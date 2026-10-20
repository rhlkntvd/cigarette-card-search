"""Check similarity between one image and example queries.

Run from the repository root:
    python -m ml.test_one_image
"""

from ml.common import (
    embed_image,
    embed_texts,
    fetch_image,
    get_iiif_url,
    load_model,
)

# Adonis Blue Butterly
IMAGE_ID = "1201324"

print("Loading model...")
processor, model = load_model()

print("Fetching NYPL image...")
image = fetch_image(IMAGE_ID)

print(f"IIIF URL: {get_iiif_url(IMAGE_ID)}")
print(f"Image size: {image.size}")

print("Generating image embedding...")
image_embedding = embed_image(
    image,
    processor,
    model,
)

print(f"Image embedding shape: {image_embedding.shape}")
print(
    "Image embedding norm:",
    image_embedding.norm(dim=-1).item(),
)

queries = [
    "a blue butterfly",
    "a large ship",
]

print("Generating text embeddings...")

text_embeddings = embed_texts(
    queries,
    processor,
    model,
)

print(f"Text embedding shape: {text_embeddings.shape}")

scores = text_embeddings @ image_embedding.T

for query, score in zip(queries, scores.squeeze(1)):
    print(f"{query!r}: {score.item():.4f}")
