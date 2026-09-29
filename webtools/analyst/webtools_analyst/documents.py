"""The documents the analyst writes, rendered from the models the configurator keeps.

**The shape of a document is configuration, not code.** The models live in
`webtools/configurator/documents/` and this subsystem holds **generated copies** in
`documents/`, put there by `configurator/documents_deployer/deploy.sh`. A copy is not
edited where it sits: the original is edited and the deployer is run again.

**Whoever produces a document renders it.** The analyst writes the analysis and the
proposal, so it holds their models; the preanalyst renders the pre-specification and
holds that one. The engines differ because the subsystems do — Jinja2 here, nunjucks
there — and a model says which one it is in its name (`.md.j2`, `.md.njk`).

What comes out is a `.md` with its own front matter, which goes to workspaces as it is
(`POST /projects/{id}/documents/{kind}`). The `webtools:` key is not written here:
workspaces stamps it when it stores the file.

**A model's words never reach the front matter.** They are markdown in the body, and
the body is where an unexpected line is a line of text rather than YAML somebody else
parses. What goes into the front matter is ours: the project, the kind, the model's
version, and the language the points were asked for.
"""

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined

DOCUMENTS = Path(__file__).resolve().parent.parent / "documents"

# Which model each document was written against. It is written into the document, so
# that a file says on its own what it was rendered from. Nobody reads it back yet, and
# what happens when a model changes has no answer (`contesto/analyst_considerations.md`
# §14.2).
ANALYSIS = "analysis/1"
PROPOSAL = "proposal/1"

_MODELS = {ANALYSIS: "analysis.md.j2", PROPOSAL: "proposal.md.j2"}

# `autoescape` off: this is markdown, and HTML escaping would turn a model's `&` and
# `<` into entities in a document nobody reads as HTML. `StrictUndefined` because a
# value that was not passed must be an error here and not an empty space in a document
# a person then reads: a missing analysis is a bug, and a bug that renders is a bug
# that ships.
_environment = Environment(
    loader=FileSystemLoader(DOCUMENTS),
    autoescape=False,
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
)


def _cell(text: str) -> str:
    """A model's sentence, made to survive one row of a table.

    Two characters end a row where it was not meant to end: a newline, and the bar
    that separates the columns. A point that carried either would be read as two
    points, or as a row with a column too many — and the list is what the client
    agrees to and the demo is later checked against.
    """
    return " ".join(str(text).split()).replace("|", "\\|")


_environment.filters["cell"] = _cell


def analysis(*, project_id: str, analysis: str, assumptions) -> str:
    """The technical analysis as a document, from what the door answered.

    `analysis` and `assumptions` are the door's output as it comes
    (`webtools_analyst/analysis_technical.py`): the text, and the notes on what had to
    be taken for granted. An empty list of assumptions is a real answer and the
    document says so — it is not a reason to leave the section out.
    """
    return _environment.get_template(_MODELS[ANALYSIS]).render(
        project_id=project_id,
        template=ANALYSIS,
        analysis=analysis,
        assumptions=list(assumptions or []),
    )


def proposal(*, project_id: str, language: str, points, texts) -> str:
    """The functional points as the document the client reads.

    `points` is the door's output as it comes (`webtools_analyst/functional_points.py`):
    elements with the identifier we gave them and the text the model wrote. `language`
    is the one the pre-specification declared, and `texts` the catalogues: the fixed
    words of this document are not written in its model, they are asked for in the
    client's language like every other text a person reads.

    A list with nothing in it is refused here. The door that writes the points already
    treats an empty list as an answer it cannot use, so an empty one arriving this far
    is a fault in the run above — and a proposal with no points is not a document to
    put in front of anybody for agreement.
    """
    listed = list(points or [])
    if not listed:
        raise ValueError("a proposal with no functional points is not a document")
    words = texts.in_language(language)
    return _environment.get_template(_MODELS[PROPOSAL]).render(
        project_id=project_id,
        template=PROPOSAL,
        language=language,
        title=words.t("analyst.proposal.title"),
        intro=words.t("analyst.proposal.intro"),
        points=listed,
    )
