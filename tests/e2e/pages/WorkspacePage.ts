import { Page, Locator } from '@playwright/test';

export class WorkspacePage {
  readonly page: Page;
  readonly screen: Locator;
  readonly sidebarButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('workspace-screen');
    this.sidebarButton = page.getByTestId('sidebar-workspace');
  }

  async navigateTo() {
    await this.sidebarButton.click({ force: true });
  }

  async isVisible() {
    return this.screen.isVisible();
  }
}
