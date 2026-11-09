package main

// #include <stdio.h>
import "C"

import (
	"fmt"
	"net/http"

	"example.com/api/missing"
	"example.com/api/types"
	"example.com/svc/internal/db"
	"example.com/tools/gen"
	"github.com/pkg/errors"
	"github.com/undeclared/x"
	"golang.org/x/text/language"
)

func main() {
	fmt.Println(http.StatusOK, types.ID{}, db.Open, gen.Run, errors.New, x.Y, language.English, missing.Z)
}
