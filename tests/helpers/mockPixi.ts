/** Lightweight headless PixiJS stand-ins for Node unit tests. */
export class MockPixiGraphics {
  calls: string[] = [];

  clear(): this {
    this.calls.push('clear');
    return this;
  }

  moveTo(x: number, y: number): this {
    this.calls.push(`moveTo(${x},${y})`);
    return this;
  }

  lineTo(x: number, y: number): this {
    this.calls.push(`lineTo(${x},${y})`);
    return this;
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): this {
    this.calls.push(`bezier(${cp1x},${cp1y},${cp2x},${cp2y},${x},${y})`);
    return this;
  }

  stroke(): this {
    this.calls.push('stroke');
    return this;
  }

  fill(): this {
    this.calls.push('fill');
    return this;
  }
}

export class MockPixiContainer {
  children: unknown[] = [];
  position = { x: 0, y: 0, set: (x: number, y: number) => ((this.position.x = x), (this.position.y = y)) };
  scale = { x: 1, y: 1, set: (v: number) => ((this.scale.x = v), (this.scale.y = v)) };

  addChild(child: unknown): void {
    this.children.push(child);
  }

  removeChildren(): void {
    this.children.length = 0;
  }
}
