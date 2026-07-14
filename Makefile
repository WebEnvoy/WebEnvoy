.PHONY: py-compile

py-compile:
	@python3 -c 'import os, py_compile, subprocess, tempfile; cache = tempfile.TemporaryDirectory(prefix="webenvoy-pycompile-"); files = [os.fsdecode(path) for path in subprocess.check_output(["git", "ls-files", "-z", "--", "*.py"]).split(b"\0") if path]; [py_compile.compile(path, cfile=f"{cache.name}/{index}.pyc", doraise=True) for index, path in enumerate(files)]; print(f"py-compile: OK ({len(files)} files)")'
