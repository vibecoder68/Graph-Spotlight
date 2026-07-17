import { App, Modal, Setting } from "obsidian";

export class SaveSetModal extends Modal {
	private name = "";

	constructor(
		app: App,
		private readonly onSubmit: (name: string) => void,
		private readonly existingName = "",
	) {
		super(app);
		this.name = existingName;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Save highlight set" });

		new Setting(contentEl)
			.setName("Name")
			.addText((text) => {
				text
					.setPlaceholder("Research threads")
					.setValue(this.name)
					.onChange((value) => {
						this.name = value;
					});

				window.setTimeout(() => text.inputEl.focus(), 20);
				text.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						this.submit();
					}
				});
			});

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText("Save")
					.setCta()
					.onClick(() => this.submit());
			})
			.addButton((button) => {
				button.setButtonText("Cancel").onClick(() => this.close());
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const trimmed = this.name.trim();
		if (!trimmed) return;
		this.onSubmit(trimmed);
		this.close();
	}
}
