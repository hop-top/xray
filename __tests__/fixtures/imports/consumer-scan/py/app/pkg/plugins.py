# Unsupported: computed names, exec / eval, search-path changes.
import importlib
import sys

name = sys.argv[1]
mod = importlib.import_module(name)
exec('import secret')
value = eval('1 + 1')
sys.path.insert(0, '/opt/plugins')
