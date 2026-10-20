package main

import (
	"fmt"
	"os"
)

// Builds only when the cgo-tagged file is part of the build: a build with
// CGO_ENABLED=0 drops platform_cgo.go and fails with "undefined: platform".
func main() {
	if len(os.Args) > 1 && os.Args[1] == "spec" {
		fmt.Printf(`{"tool":"cgopair","version":"1","schema_version":"1.0","commands":[{"path":["cgopair","probe"],"short":%q}]}`, platform())
		return
	}
	os.Exit(2)
}
