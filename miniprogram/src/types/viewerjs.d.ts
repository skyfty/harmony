declare module 'viewerjs' {
  export interface ViewerOptions {
    inline?: boolean;
    toolbar?: boolean | Array<string>;
    navbar?: boolean;
    title?: boolean;
    tooltip?: boolean;
    movable?: boolean;
    zoomable?: boolean;
    rotatable?: boolean;
    scalable?: boolean;
    transition?: boolean;
    fullscreen?: boolean;
    zIndex?: number;
    [key: string]: unknown;
  }

  export default class Viewer {
    constructor(element: HTMLElement, options?: ViewerOptions);
    show(): void;
    hide(): void;
    view(index: number): void;
    update(): void;
    destroy(): void;
  }
}
