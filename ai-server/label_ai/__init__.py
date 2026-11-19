"""label_ai - a local, open-weight AI inference server for the label editor."""

__version__ = "1.0.0"

CAPABILITIES: tuple[str, ...] = (
    "segment",
    "subject",
    "segment_text",
    "matte",
    "remove",
    "inpaint",
    "generate",
    "variations",
    "edit",
)
