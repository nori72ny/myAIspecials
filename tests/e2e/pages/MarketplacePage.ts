import { Page, Locator } from '@playwright/test';

export class MarketplacePage {
  readonly page: Page;
  readonly screen: Locator;
  readonly sidebarButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('marketplace-screen');
    this.sidebarButton = page.getByTestId('sidebar-marketplace');
  }

  async navigateTo() {
    await this.sidebarButton.click({ force: true });
  }

  async isVisible() {
    return this.screen.isVisible();
  }
}
