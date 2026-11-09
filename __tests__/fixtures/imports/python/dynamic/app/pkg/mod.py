import importlib as il
import importlib.util
from importlib import import_module
from importlib import import_module as load

os_mod = __import__('os.path')
rel = __import__('sibling', globals(), level=1)
json = importlib.import_module('json')
a = il.import_module("app.pkg.a")
b = import_module('.b', package='app.pkg')
c = load('..c', 'app.pkg')
d = import_module('.d', package=__name__)
e = import_module('..e', package=__package__)
f = import_module('x' 'y')


def later():
    return il.import_module(name='late.mod')


# Not literal / not resolvable: deferred.
name = 'json'
__import__(name)
import_module(f'mod_{name}')
import_module('.nopkg')
import_module('.dyn', package=name)
import_module(b'bytes')
import_module('esc\x2e')

# Not importlib bindings.
util = importlib.util.find_spec('x')
other.import_module('nope')
