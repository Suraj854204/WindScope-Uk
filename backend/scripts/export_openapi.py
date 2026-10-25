"""Write the OpenAPI contract to docs/openapi.json (run: PYTHONPATH=. python scripts/export_openapi.py)."""

import json
import tempfile
from pathlib import Path

from app.config import Settings
from app.main import create_app

if __name__ == "__main__":
    settings = Settings(_env_file=None, cache_dir=Path(tempfile.mkdtemp()), auto_ingest_on_startup=False)
    spec = create_app(settings).openapi()
    out = Path(__file__).resolve().parents[2] / "docs" / "openapi.json"
    out.write_text(json.dumps(spec, indent=2) + "\n")
    print(f"wrote {out} ({len(spec['paths'])} paths)")
