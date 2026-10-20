package main

import (
	"context"
	"fmt"
	"os"

	"github.com/spf13/cobra"
	speccli "hop.top/kit/go/ai/toolspec/cli"
	kitcli "hop.top/kit/go/console/cli"
)

func leaf(parent *cobra.Command, use, short string, se kitcli.SideEffect, id kitcli.Idempotency) *cobra.Command {
	c := &cobra.Command{Use: use, Short: short, Long: short + " (long description)", RunE: func(*cobra.Command, []string) error { return nil }}
	kitcli.SetSideEffect(c, se)
	kitcli.SetIdempotency(c, id)
	parent.AddCommand(c)
	return c
}

func main() {
	root := kitcli.New(kitcli.Config{Name: "demo", Version: "0.1.0", Short: "Demo kit CLI"}, kitcli.WithStatus(kitcli.StatusConfig{}))
	list := leaf(root.Cmd, "list", "List items", kitcli.SideEffectRead, kitcli.IdempotencyYes)
	kitcli.SetTopLevelVerb(list)
	list.Flags().StringP("filter", "f", "", "filter expression")
	grp := &cobra.Command{Use: "item", Short: "Item commands"}
	root.Cmd.AddCommand(grp)
	add := leaf(grp, "add", "Add an item", kitcli.SideEffectWrite, kitcli.IdempotencyNo)
	add.Flags().Bool("force", false, "overwrite")
	leaf(grp, "purge", "Purge items", kitcli.SideEffectDestructive, kitcli.IdempotencyNo)
	if err := speccli.RegisterSpecCommand(root, "1.0"); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := root.Execute(context.Background()); err != nil {
		os.Exit(1)
	}
}
