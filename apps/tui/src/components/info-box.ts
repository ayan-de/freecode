import { truncateToWidth, type Component } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { logoLines } from "../assets/logo.js";
import { getModelDisplayString, getDisplayDirectory, getVersion } from "../utils/display.js";

const coloredLogoLines = logoLines.map(line => {
	const mid = Math.floor(line.length / 2);
	return chalk.yellowBright(line.slice(0, mid)) + chalk.yellow(line.slice(mid));
});
while (coloredLogoLines.length < 4) {
	coloredLogoLines.push(" ".repeat(34));
}

export class ResponsiveInfoBox implements Component {
	constructor(
		private getProvider: () => string,
		private getModel: () => string
	) {}

	render(width: number): string[] {
		if (width < 80) {
			const boxWidth = Math.max(0, width - 2);
			const padLeft = Math.max(0, Math.floor((boxWidth - 34) / 2));
			const padRight = Math.max(0, boxWidth - 34 - padLeft);

			const emptyLine = `│${" ".repeat(boxWidth)}│`;

			const cwdPath = getDisplayDirectory();
			const modelStr = getModelDisplayString(this.getProvider(), this.getModel());

			const modelPadL = Math.max(0, Math.floor((boxWidth - modelStr.length) / 2));
			const modelPadR = Math.max(0, boxWidth - modelStr.length - modelPadL);
			const modelLine = `│${" ".repeat(modelPadL)}${chalk.dim(modelStr)}${" ".repeat(modelPadR)}│`;

			const dirPadL = Math.max(0, Math.floor((boxWidth - cwdPath.length) / 2));
			const dirPadR = Math.max(0, boxWidth - cwdPath.length - dirPadL);
			const dirLine = `│${" ".repeat(dirPadL)}${cwdPath}${" ".repeat(dirPadR)}│`;

			const infoBoxLines = [
				`╭${"─".repeat(boxWidth)}╮`,
				emptyLine,
				emptyLine,
				emptyLine,
				emptyLine,
				`│${" ".repeat(padLeft)}${coloredLogoLines[0]}${" ".repeat(padRight)}│`,
				`│${" ".repeat(padLeft)}${coloredLogoLines[1]}${" ".repeat(padRight)}│`,
				`│${" ".repeat(padLeft)}${coloredLogoLines[2]}${" ".repeat(padRight)}│`,
				emptyLine,
				modelLine,
				dirLine,
				emptyLine,
				`╰${"─".repeat(boxWidth)}╯`,
			];
			return infoBoxLines.map(line => truncateToWidth(chalk.white(line), width));
		}

		const leftColWidth = 50;
		const rightColWidth = Math.max(20, width - leftColWidth - 3);
		const cwdPath = getDisplayDirectory();

		const logoPadLeft = Math.max(0, Math.floor((leftColWidth - 34) / 2));
		const logoPadRight = Math.max(0, leftColWidth - 34 - logoPadLeft);
		const padL = " ".repeat(logoPadLeft);
		const padR = " ".repeat(logoPadRight);

		const infoBoxLines = [
			`╭${"─".repeat(leftColWidth)}┬${"─".repeat(rightColWidth)}╮`,
			`│${" ".repeat(leftColWidth)}│${" ".repeat(rightColWidth)}│`,
			`│${" ".repeat(leftColWidth)}│${" ".repeat(rightColWidth)}│`,
			`│${" ".repeat(leftColWidth)}│ >_ ${chalk.bold.yellowBright("FreeCode")} (v${getVersion()})${" ".repeat(Math.max(0, rightColWidth - 16 - getVersion().length))}│`,
			`│${padL}${coloredLogoLines[0]}${padR}│${" ".repeat(rightColWidth)}│`,
			`│${padL}${coloredLogoLines[1]}${padR}│ /help for help   ${chalk.yellowBright("/model")} to change${" ".repeat(Math.max(0, rightColWidth - 34))}│`,
			`│${padL}${coloredLogoLines[2]}${padR}│${" ".repeat(rightColWidth)}│`,
			`│${" ".repeat(leftColWidth)}│ ${chalk.bold.yellowBright("Directory:")} ${cwdPath}${" ".repeat(Math.max(0, rightColWidth - 12 - cwdPath.length))}│`,
			`│${" ".repeat(leftColWidth)}│${" ".repeat(rightColWidth)}│`,
			`│${" ".repeat(leftColWidth)}│${" ".repeat(rightColWidth)}│`,
			`╰${"─".repeat(leftColWidth)}┴${"─".repeat(rightColWidth)}╯`,
		];
		return infoBoxLines.map(line => truncateToWidth(chalk.white(line), width));
	}

	invalidate(): void {}
}
