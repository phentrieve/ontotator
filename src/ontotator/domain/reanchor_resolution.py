"""Frozen review inputs, authorized pending context and exact reviewer resolutions."""

from dataclasses import asdict
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from ontotator.domain.annotations import AnnotationRef
from ontotator.domain.documents import EvidenceRef
from ontotator.domain.reanchor import TextSpan, TextWindow, relocate


class TextWindowView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    text: str

    @model_validator(mode="after")
    def valid_window(self) -> "TextWindowView":
        if self.end < self.start or len(self.text) != self.end - self.start:
            raise ValueError("Invalid absolute text window")
        return self


class OldMentionView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_ref: EvidenceRef
    segments: list[TextWindowView]
    cue_segments: list[TextWindowView]


class OldModifierView(BaseModel):
    """A modifier of the frozen predecessor (C6 ``OldModifier``)."""

    model_config = ConfigDict(extra="forbid")
    term_id: str
    segments: list[TextWindowView] = Field(default_factory=list)


class WindowOpcodeView(BaseModel):
    model_config = ConfigDict(extra="forbid")
    op: Literal["equal", "replace", "insert", "delete"]
    old_start: int = Field(ge=0)
    old_end: int = Field(ge=0)
    new_start: int = Field(ge=0)
    new_end: int = Field(ge=0)
    old_text: str
    new_text: str

    @model_validator(mode="after")
    def valid_ranges(self) -> "WindowOpcodeView":
        if self.old_end - self.old_start != len(
            self.old_text
        ) or self.new_end - self.new_start != len(self.new_text):
            raise ValueError("Invalid absolute opcode ranges")
        return self


class ReanchorItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposal_set_id: int
    source_ref: AnnotationRef
    term_id: str
    layer_id: str
    # Enriched only in authorized workspace context; never written into producer JSON.
    type_id: str | None = None
    axes_values: dict[str, str | None] | None = None
    axes_defaulted: list[str] | None = None
    reason: Literal[
        "source_text_mismatch",
        "missing_evidence",
        "evidence_version_mismatch",
        "ambiguous_evidence",
        "evidence_source_mismatch",
        "invalid_bounds",
        "changed_segment",
        "changed_cue",
        "changed_modifier_segment",
    ]
    old_mentions: list[OldMentionView]
    # Left out of the dump while empty, so stored items and hashes stay.
    old_modifiers: list[OldModifierView] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )
    old_context: TextWindowView
    new_context: TextWindowView
    diff: list[WindowOpcodeView]
    # Computed for the workspace (#633), never stored: where the old words
    # occur unchanged in the current text (each the mention's segments there),
    # else the new wording that replaced them.
    suggestions: list[list[TextWindowView]] = Field(
        default_factory=list, exclude_if=lambda value: not value
    )
    changed_at: TextWindowView | None = Field(
        default=None, exclude_if=lambda value: value is None
    )

    @computed_field
    def old_segments(self) -> list[TextWindowView]:
        return [
            segment
            for mention in self.old_mentions
            for segment in [*mention.segments, *mention.cue_segments]
        ]


class PendingReanchorRef(BaseModel):
    model_config = ConfigDict(extra="forbid")
    proposal_set_id: int
    source_ref: AnnotationRef


class ReanchorResolution(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item: PendingReanchorRef
    outcome: Literal["recreated", "dismissed"]
    replacement: AnnotationRef | None = None
    reason: str | None = None
    reviewer_id: str

    @model_validator(mode="after")
    def valid_outcome(self) -> "ReanchorResolution":
        if self.outcome == "recreated":
            if self.replacement is None or self.reason is not None:
                raise ValueError(
                    "Recreated resolution requires an exact replacement only"
                )
        elif self.replacement is not None or not (self.reason and self.reason.strip()):
            raise ValueError("Dismissed resolution requires a nonblank reason only")
        if self.reason is not None:
            self.reason = self.reason.strip()
        return self


def with_relocation(item: ReanchorItem, text: str) -> ReanchorItem:
    """The item with its suggested locations in ``text`` (the current text, #633).

    Only an item of one mention whose evidence text changed is relocated; the
    current context then shows where the old words are, not the end of a
    reordered block. Anything else stays as stored.
    """
    if not item.reason.startswith("changed_") or len(item.old_mentions) != 1:
        return item
    new = item.new_context
    if new.end > len(text) or text[new.start : new.end] != new.text:
        return item
    found = relocate(
        [TextSpan(s.start, s.end, s.text) for s in item.old_mentions[0].segments],
        TextWindow(item.old_context.start, item.old_context.end, item.old_context.text),
        TextWindow(new.start, new.end, new.text),
        text,
    )
    if found.new_context is None:
        return item
    return item.model_copy(
        update={
            "suggestions": [
                [TextWindowView(**asdict(s)) for s in place]
                for place in found.suggestions
            ],
            "changed_at": TextWindowView(**asdict(found.changed_at))
            if found.changed_at
            else None,
            "new_context": TextWindowView(**asdict(found.new_context)),
            "diff": [WindowOpcodeView(**asdict(op)) for op in found.diff],
        }
    )
