"""Package a committed Coastal PS Guides snapshot for local use."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parent.parent
PREFIX = "CoastalPSGuides"
DATA_ADDONS = ("Polestar_Codex", "Polestar_QuestDB")
NOTICES = ("LICENSE", "LICENSE-EXCEPTION.md", "THIRD_PARTY.md")


def git(*args):
    return subprocess.check_output(("git", *args), cwd=ROOT, text=True).strip()


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def file_hashes(folder):
    return {
        file.relative_to(folder).as_posix(): digest(file)
        for file in sorted(folder.rglob("*"))
        if file.is_file()
    }


def build(version, source, data_addons):
    revision = git("rev-parse", "--verify", "--end-of-options", source + "^{commit}")
    base_version = json.loads(git("show", revision + ":package.json"))["version"]
    releases = ROOT / "dist" / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    if releases.resolve() != releases:
        raise ValueError("dist/releases must be inside the checkout")
    destination = releases / version
    if destination.exists():
        raise FileExistsError(destination)

    with tempfile.TemporaryDirectory(prefix=".build-", dir=releases) as directory:
        work = Path(directory)
        checkout = work / "source"
        snapshot = work / "source.zip"
        git("archive", "--format=zip", "-o", str(snapshot), revision, "--",
            "addon", "tools/coastal-dev.js", *NOTICES)
        with ZipFile(snapshot) as archive:
            archive.extractall(checkout)

        subprocess.run(
            ("node", "tools/coastal-dev.js", "--data-addons", str(data_addons)),
            cwd=checkout, check=True,
        )
        stage = checkout / "dist" / PREFIX
        package = stage / PREFIX
        toc = package / (PREFIX + ".toc")
        original = toc.read_bytes()
        pattern = rb"^(## Version: [^\r\n]+)(\r?\n)"
        versioned, count = re.subn(
            pattern,
            lambda match: match[1] + match[2] + b"## X-Coastal-Release: "
            + version.encode("ascii") + match[2],
            original,
            count=1,
            flags=re.M,
        )
        if count != 1 or b"## Title: Coastal PS Guides" not in original:
            raise ValueError("Unexpected Coastal PS Guides manifest")
        toc.write_bytes(versioned)
        for notice in NOTICES:
            (package / notice).write_bytes((checkout / notice).read_bytes())

        generated_data = {}
        for name in DATA_ADDONS:
            folder = stage / name.replace("Polestar", PREFIX, 1)
            addon_toc = folder / (folder.name + ".toc")
            if not re.search(
                rf"^## Version: {re.escape(base_version)}\r?$",
                addon_toc.read_text(encoding="utf-8"),
                re.M,
            ):
                raise ValueError(f"{name} must match addon version {base_version}")
            generated_data[name] = file_hashes(folder)
        (package / "release.json").write_text(
            json.dumps({
                "release": version,
                "source_commit": revision,
                "addon_compatibility_version": base_version,
                "packaged_data_sha256": generated_data,
            }, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )

        output = work / "release"
        output.mkdir()
        filename = f"{PREFIX}-{version}.zip"
        zip_path = output / filename
        with ZipFile(zip_path, "w", compression=ZIP_DEFLATED, compresslevel=6) as archive:
            for file in sorted(stage.rglob("*")):
                if file.is_file():
                    member = ZipInfo(file.relative_to(stage).as_posix())
                    archive.writestr(member, file.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=6)
        with ZipFile(zip_path) as archive:
            if archive.testzip() is not None:
                raise ValueError("Release ZIP failed its integrity check")
            for folder in stage.iterdir():
                if folder.is_dir():
                    archive.getinfo(f"{folder.name}/{folder.name}.toc")
        (output / "SHA256SUMS").write_text(
            f"{digest(zip_path)}  {filename}\n", encoding="ascii", newline="\n",
        )
        output.rename(destination)
    print(destination / filename)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="Coastal release version, for example 0.1.0")
    parser.add_argument("--source", default="HEAD", help="Git ref for the source snapshot")
    parser.add_argument(
        "--data-addons", type=Path, default=ROOT / "addon",
        help="Directory containing the generated Codex and QuestDB folders",
    )
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", args.version):
        parser.error("version must be major.minor.patch")
    build(args.version, args.source, args.data_addons.resolve())
