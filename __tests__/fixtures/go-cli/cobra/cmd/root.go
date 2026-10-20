package cmd

import (
	"os"

	"github.com/spf13/cobra"

	"example.com/cobrademo/internal/serve"
)

const rootUse = "cobrademo"

var verbose bool

var rootCmd = &cobra.Command{
	Use:   rootUse + " [command]",
	Short: "Demo cobra CLI",
	Long:  `Long description
for the demo.`,
}

func Execute() {
	if err := rootCmd.Execute(); err != nil {
		os.Exit(1)
	}
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	rootCmd.Flags().StringP("config", "c", "app.yaml", "config file")
	rootCmd.AddCommand(deployCmd)
	rootCmd.AddCommand(newVersionCmd(), serve.NewCmd())
}
