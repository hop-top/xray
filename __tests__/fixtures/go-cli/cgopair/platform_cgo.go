//go:build cgo

package main

/*
static int add(int a, int b) { return a + b; }
*/
import "C"

import "fmt"

func platform() string { return fmt.Sprintf("cgo:%d", int(C.add(1, 2))) }
