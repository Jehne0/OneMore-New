export class WidgetRenderGate {
  private generations = new Map<number, number>();

  begin(widgetId: number): number {
    const generation = (this.generations.get(widgetId) ?? 0) + 1;
    this.generations.set(widgetId, generation);
    return generation;
  }

  isCurrent(widgetId: number, generation: number): boolean {
    return this.generations.get(widgetId) === generation;
  }

  remove(widgetId: number) {
    this.generations.delete(widgetId);
  }
}
