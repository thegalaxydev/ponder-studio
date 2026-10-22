import { openDocument, openStructure } from './app.js';
import { openPanel } from './panel.js';

modsmith.registerViewer('structure', (root, ctx) => openStructure(root, ctx));
modsmith.registerViewer('document', (root, ctx) => openDocument(root, ctx));
modsmith.registerPanel('scenes', (root, ctx) => openPanel(root, ctx));
