// Unsupported: cgo, plugin loading, linkname.
package main

/*
#include <stdio.h>
*/
import "C"

import (
	"plugin"
	_ "unsafe"
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

func load() { plugin.Open("x.so") }
