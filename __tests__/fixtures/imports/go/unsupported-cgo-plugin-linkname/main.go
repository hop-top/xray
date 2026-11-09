package main

/*
#include <stdio.h>
*/
import "C"

import (
	"fmt"
	plug "plugin"
	_ "unsafe"
)

//go:linkname nanotime runtime.nanotime
func nanotime() int64

func main() {
	p, _ := plug.Open("ext.so")
	fmt.Println(p, nanotime())
}
