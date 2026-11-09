# Call-based forms with literal names.
import importlib
from importlib import import_module as im

yaml = importlib.import_module('yaml')
sibling = im('.helpers', __package__)
legacy = __import__('xml.dom', fromlist=['minidom'])
