package cmd

import "github.com/spf13/cobra"

func newVersionCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "version",
		Short: "Print version",
	}
	cmd.Flags().Bool("short", false, "short form")
	return cmd
}
