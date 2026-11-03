// Static forms: single, grouped, aliased, dot, blank; workspace module,
// own module, required module, stdlib.
package main

import "fmt"

import (
	"os"
	api "example.com/api"
	. "strings"
	_ "embed"

	"example.com/svc/internal"
	"github.com/google/uuid"
)

func main() {
	fmt.Println(os.Args, api.Event{}, ToUpper("x"), internal.X, uuid.New())
}
