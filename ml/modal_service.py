"""Deploy the embedding service: python -m modal deploy ml/modal_service.py."""

from pathlib import Path

import modal


def cache_model():
    from ml.common import load_model

    load_model()


image = None
# Modal reimports this module in containers where repository paths do not exist.
if modal.is_local():
    root = Path(__file__).resolve().parents[1]
    requirements = root / "requirements.txt"
    torch_requirement = next(
        line
        for line in requirements.read_text().splitlines()
        if line.startswith("torch==")
    )
    image = (
        modal.Image.debian_slim(python_version="3.13")
        # Install CPU PyTorch first to avoid downloading unused CUDA libraries.
        .pip_install(
            torch_requirement, index_url="https://download.pytorch.org/whl/cpu"
        )
        .pip_install_from_requirements(str(requirements))
        .env(
            {"HF_HOME": "/model-cache", "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"}
        )
        .add_local_file(root / "ml/common.py", "/root/ml/common.py", copy=True)
        .run_function(cache_model, memory=4096)
        .env({"HF_HUB_OFFLINE": "1"})
        .add_local_file(
            root / "ml/embedding_service.py", "/root/ml/embedding_service.py"
        )
    )

app = modal.App("cigarette-card-search")


@app.function(
    image=image,
    cpu=2,
    memory=4096,
    min_containers=0,
    max_containers=1,
    scaledown_window=120,
    timeout=60,
)
@modal.asgi_app(requires_proxy_auth=True)
def serve():
    from ml.embedding_service import app as embedding_app

    return embedding_app
