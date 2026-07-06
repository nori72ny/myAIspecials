import { Page, Locator } from '@playwright/test';

export class MissionPage {
  readonly page: Page;
  readonly screen: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('mission-screen');
  }

  async isVisible() {
    return this.screen.isVisible();
  }
}
