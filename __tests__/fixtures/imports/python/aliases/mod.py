import os
import os.path as osp, sys
import xml.etree.ElementTree
import numpy as np
s = 'é😀'; import json as j


def lazy():
    import importlib.util as iu
    return iu


try:
    import ujson as fastjson
except ImportError:
    fastjson = None
