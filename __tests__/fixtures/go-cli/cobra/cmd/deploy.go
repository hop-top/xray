package cmd

import "github.com/spf13/cobra"

var deployCmd = &cobra.Command{
	Use:     "deploy <target>",
	Short:   "Deploy the application",
	Aliases: []string{"ship"},
}

var rollbackCmd = &cobra.Command{
	Use:    "rollback",
	Short:  "Roll back a deploy",
	Hidden: true,
}

func init() {
	deployCmd.AddCommand(rollbackCmd)
	flags := deployCmd.Flags()
	flags.Int("replicas", 1, "replica count")
	flags.StringVar(&target, "target", "prod", "deploy target")
}

var target string
