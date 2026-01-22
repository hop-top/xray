import chalk from 'chalk';

export class Logger {
    static info(message: string) {
        console.log(chalk.blue('ℹ') + ' ' + message);
    }

    static success(message: string) {
        console.log(chalk.green('✔') + ' ' + message);
    }

    static warn(message: string) {
        console.warn(chalk.yellow('⚠') + ' ' + message);
    }

    static error(message: string, error?: any) {
        console.error(chalk.red('✖') + ' ' + message);
        if (error) {
            console.error(chalk.red(error));
        }
    }

    static log(message: string) {
        console.log(message);
    }
}
