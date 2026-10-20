package main

import (
	"os"

	"github.com/urfave/cli/v2"
)

var syncCmd = &cli.Command{
	Name:  "sync",
	Usage: "Sync remote state",
	Flags: []cli.Flag{
		&cli.BoolFlag{Name: "dry-run", Aliases: []string{"n"}, Usage: "do not apply"},
	},
}

func main() {
	app := &cli.App{
		Name:  "urfavedemo",
		Usage: "Demo urfave CLI",
		Flags: []cli.Flag{
			&cli.StringFlag{Name: "config", Aliases: []string{"c"}, Usage: "config file", Value: "app.toml"},
		},
		Commands: []*cli.Command{
			{
				Name:  "db",
				Usage: "Database tools",
				Subcommands: []*cli.Command{
					{Name: "migrate", Usage: "Run migrations"},
					{Name: "reset", Usage: "Reset database", Flags: []cli.Flag{&cli.IntFlag{Name: "limit", Usage: "max rows"}}},
				},
			},
			syncCmd,
		},
	}
	_ = app.Run(os.Args)
}
