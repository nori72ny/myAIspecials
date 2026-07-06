import { Page, Locator } from '@playwright/test';

export class ResultDashboardPage {
  readonly page: Page;
  readonly screen: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('result-dashboard');
  }

  async isVisible() {
    return this.screen.isVisible();
  }
}
