"""Where a build may write, and where it may not.

The paths come out of a model, and the writing is done by **this** process, which is
not confined at all: it holds the keys and can write wherever the user can. So every
one of these is a path that must never become a file.

    uv run pytest
"""

import pytest

from webtools_developer.workspace import PathRefused, Workspace, fresh


class Build:
    """Just enough settings to name a builds root."""

    def __init__(self, root):
        self.build = type("B", (), {"root": root})()


@pytest.fixture
def area(tmp_path):
    directory = tmp_path / "build"
    directory.mkdir()
    return Workspace(directory)


def test_a_file_is_written_where_it_was_asked_for(area):
    size = area.write("src/server.js", "const a = 1;\n")
    assert (area.directory / "src" / "server.js").read_text() == "const a = 1;\n"
    assert size == 13


def test_a_file_is_read_back_off_the_disk(area):
    area.write("package.json", '{"name":"x"}')
    assert area.read("package.json") == '{"name":"x"}'


@pytest.mark.parametrize(
    "path",
    [
        "../escaped.txt",
        "src/../../escaped.txt",
        "/etc/passwd",
        "",
        "with\0nul.txt",
        "windows\\path.txt",
        "C:/drive.txt",
    ],
)
def test_a_path_that_is_not_this_build_s_is_refused(area, path):
    with pytest.raises(PathRefused):
        area.resolve(path)


def test_a_path_written_with_a_leading_dot_is_the_same_path(area):
    """`./index.html` means `index.html`, and it is inside the build either way. It is
    not refused: the parsing removes the dot, and refusing it would refuse a file whose
    name is merely written a second legitimate way."""
    area.write("./index.html", "<!doctype html>")
    assert (area.directory / "index.html").read_text() == "<!doctype html>"


def test_a_path_that_goes_through_a_symbolic_link_is_refused(area, tmp_path):
    """The oldest way round a check that only reads the string it was given: the name
    has no `..` in it at all."""
    outside = tmp_path / "outside"
    outside.mkdir()
    (area.directory / "link").symlink_to(outside)
    with pytest.raises(PathRefused):
        area.resolve("link/escaped.txt")


def test_nothing_is_created_by_a_path_that_is_refused(area):
    """The parent directories are made **after** the path is checked: creating a
    directory is already a write, and a path that escapes would have escaped by the
    time the file itself was refused."""
    with pytest.raises(PathRefused):
        area.write("../made/anyway.txt", "x")
    assert not (area.directory.parent / "made").exists()


def test_a_build_starts_from_an_empty_directory(tmp_path):
    """A file left over from a previous attempt would be delivered without being in the
    plan, and a check could pass because of something nobody wrote this time."""
    settings = Build(tmp_path)
    first = fresh(settings, "a-project")
    first.write("leftover.txt", "from the last attempt")
    second = fresh(settings, "a-project")
    assert list(second.directory.iterdir()) == []


@pytest.mark.parametrize("project_id", ["..", ".", "", "../../etc", "a/b"])
def test_a_project_identifier_that_is_not_a_name_is_refused(tmp_path, project_id):
    """It arrives on a route, so it is a name from outside like any other: a `..` in it
    would put the build somewhere else, and every later check would then be checking the
    wrong directory."""
    with pytest.raises(PathRefused):
        fresh(Build(tmp_path), project_id)
