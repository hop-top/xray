package serve

import "github.com/spf13/cobra"

func NewCmd() *cobra.Command {
	c := &cobra.Command{Use: "serve", Short: "Start the server"}
	c.Flags().IntP("port", "p", 8080, "listen port")
	c.Flags().Duration("timeout", 0, "request timeout")
	return c
}
