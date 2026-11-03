def __import__(name):
    return name


__import__('shadowed')


def import_module(name):
    return name


import_module('unbound-local-def')
