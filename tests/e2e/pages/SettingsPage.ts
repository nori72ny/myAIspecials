import { Page, Locator } from '@playwright/test';

export class SettingsPage {
  readonly page: Page;
  readonly modal: Locator;
  readonly screen: Locator;
  readonly openModalButton: Locator;
  readonly closeModalButton: Locator;
  readonly openScreenButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.modal = page.getByTestId('settings-modal');
    this.screen = page.getByTestId('settings-screen');
    this.openModalButton = page.getByTestId('settings-button');
    this.closeModalButton = page.getByTestId('close-settings-button');
    this.openScreenButton = page.getByTestId('sidebar-organization');
  }

  async openModal() {
    await this.openModalButton.click({ force: true });
  }

  async closeModal() {
    await this.closeModalButton.click({ force: true });
  }

  async isModalVisible() {
    return this.modal.isVisible();
  }

  async navigateToScreen() {
    await this.openScreenButton.click({ force: true });
  }

  async isScreenVisible() {
    return this.screen.isVisible();
  }
}
