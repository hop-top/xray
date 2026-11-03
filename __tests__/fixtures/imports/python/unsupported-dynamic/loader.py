import importlib
import importlib.util
import sys

sys.path.insert(0, "/opt/plugins")

mod = __import__(name)
plugin = importlib.import_module(f"plugins.{name}")
ok = importlib.import_module("json")

spec = importlib.util.spec_from_file_location(name, path)
module = importlib.util.module_from_spec(spec)

exec(source)
value = eval(expr)
