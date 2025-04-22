// Plugin for UI evaluation using Claude API

// Define the expected structure for analysis results
interface AnalysisResult {
  heuristic: string;
  issue: string;
  suggestion: string;
}

// Define the structure for component data
interface ComponentData {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  childrenCount: number;
  children: LayerData[];
  layoutMode: string | null;
  padding?: { top: number; right: number; bottom: number; left: number };
  itemSpacing?: number;
}

interface LayerData {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  visible: boolean;
  characters?: string;
  fontSize?: number;
  fontName?: FontName;
  fills?: Paint[];
  strokes?: Paint[];
  opacity?: number;
}

const SERVER_URL = 'http://localhost:3000/analyze';

async function analyzeComponentWithClaude(componentData: ComponentData, principles: string): Promise<AnalysisResult[]> {
  console.log('Sending data to server:', { componentData, principles });
  try {
    const response = await fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ componentData, principles }),
    });

    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: response.statusText };
      }
      console.error('Server returned an error:', response.status, errorData);
      throw new Error(`Server error: ${errorData.error || response.statusText}`);
    }

    const results: AnalysisResult[] = await response.json();
    console.log('Received analysis results from server:', results);
    return results;
  } catch (error) {
    console.error('Error calling backend server:', error);
    let errorMessage = 'An unknown error occurred';
    if (error instanceof Error) {
        errorMessage = error.message;
    }
    figma.notify(`Error analyzing component: ${errorMessage}`, { error: true });
    throw error;
  }
}

// This plugin will open a window to prompt the user to enter a number, and
// it will then create that many rectangles on the screen.

// This file holds the main code for plugins. Code in this file has access to
// the *figma document* via the figma global object.
// You can access browser APIs in the <script> tag inside "ui.html" which has a
// full browser environment (See https://www.figma.com/plugin-docs/how-plugins-run).

// Import necessary functions/types and the DB data
// import { analyzeComponentWithClaude, AnalysisResult, ComponentData } from './claude';
// Option 1: Statically import db.json (requires esModuleInterop and resolveJsonModule in tsconfig.json)
// import dbData from './db.json';
// const principlesPromptSegment = dbData.rules_prompt_segment;

// Option 2: Define the principles string directly or load differently if static import is not set up
// Note: You'll need to manually copy the 'rules_prompt_segment' from db.json here if not using static import.
const principlesPromptSegment = "Based on the principles [...list from db.json...], analyze the component for potential issues related to: visual hierarchy, contrast, scale, similarity, proximity, closure, common region, golden ratio, aesthetic and minimalist design, error prevention/recovery, and help/documentation access."; // Replace [...] with actual content

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 300, height: 450 }); // Adjust size as needed

let currentSelectedFrame: FrameNode | null = null;

// --- Helper Functions ---

function findParentFrame(node: SceneNode | null): FrameNode | null {
  if (!node) return null;
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'FRAME') {
      return parent as FrameNode;
    }
    if (parent.type === 'PAGE') {
      // Reached the page level without finding a frame, maybe the node itself is a top-level frame?
      if (node.type === 'FRAME') return node;
      return null;
    }
    parent = parent.parent;
  }
   // If the node itself is a Frame and has no parent Frame above it
  if (node.type === 'FRAME') return node;
  return null;
}

function getFrameHierarchy(node: SceneNode): string {
    const path: string[] = [];
    let current: BaseNode | null = node;
    while (current && current.type !== 'PAGE') {
        path.unshift(current.name);
        current = current.parent;
    }
    return path.join(' > ');
}

function extractComponentData(frame: FrameNode): ComponentData {
  // Extract children data recursively
  const extractLayerData = (node: SceneNode): LayerData => {
    const baseData: LayerData = {
      id: node.id,
      name: node.name,
      type: node.type,
      width: 'width' in node ? node.width : 0,
      height: 'height' in node ? node.height : 0,
      x: node.x,
      y: node.y,
      visible: node.visible
    };

    // Add opacity if available
    if ('opacity' in node) {
      baseData.opacity = node.opacity;
    }

    // Add text-specific properties
    if (node.type === 'TEXT') {
      const textNode = node as TextNode;
      if (textNode.fontSize !== figma.mixed) {
        baseData.fontSize = textNode.fontSize;
      }
      if (textNode.fontName !== figma.mixed) {
        baseData.fontName = textNode.fontName;
      }
      baseData.characters = textNode.characters;
    }

    // Add style properties if available
    if ('fills' in node) {
      const fills = (node as GeometryMixin).fills;
      if (Array.isArray(fills)) {
        baseData.fills = fills;
      }
    }
    if ('strokes' in node) {
      const strokes = (node as GeometryMixin).strokes;
      if (Array.isArray(strokes)) {
        baseData.strokes = strokes;
      }
    }

    return baseData;
  };

  // Get padding if it exists
  const padding = frame.layoutMode !== "NONE" ? {
    top: frame.paddingTop,
    right: frame.paddingRight,
    bottom: frame.paddingBottom,
    left: frame.paddingLeft
  } : undefined;

  // Extract data for the frame and all its children
  return {
    id: frame.id,
    name: frame.name,
    type: frame.type,
    width: frame.width,
    height: frame.height,
    childrenCount: frame.children.length,
    children: frame.children.map(child => extractLayerData(child)),
    layoutMode: frame.layoutMode,
    padding: padding,
    itemSpacing: frame.layoutMode !== "NONE" ? frame.itemSpacing : undefined
  };
}

async function updateSelectionInfo() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        currentSelectedFrame = null;
        figma.ui.postMessage({ type: 'selection-info', data: { name: 'None', hierarchy: 'N/A' } });
        return;
    }

    if (selection.length > 1) {
        currentSelectedFrame = null;
        figma.notify('Please select only one element.', { error: true });
        figma.ui.postMessage({ type: 'selection-info', data: { name: 'Multiple Selected', hierarchy: 'N/A' } });
        return;
    }

    const selectedNode = selection[0];
    const parentFrame = findParentFrame(selectedNode);

    if (parentFrame) {
        currentSelectedFrame = parentFrame;
        const hierarchy = getFrameHierarchy(parentFrame);
        figma.ui.postMessage({ type: 'selection-info', data: { name: parentFrame.name, hierarchy: hierarchy } });
    } else {
        currentSelectedFrame = null;
        figma.notify('Selected element is not inside a Frame. Please select an element within a Frame or a Frame itself.', { error: true });
        figma.ui.postMessage({ type: 'selection-info', data: { name: 'No Parent Frame', hierarchy: getFrameHierarchy(selectedNode) } });
    }
}

async function createAnnotation(feedback: AnalysisResult, targetNode: SceneNode) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });

    const PADDING = 10;
    const SPACING = 8;
    const CARD_WIDTH = 200;

    const textNodeHeuristic = figma.createText();
    textNodeHeuristic.characters = `Principle: ${feedback.heuristic}`;
    textNodeHeuristic.fontSize = 10;
    textNodeHeuristic.fontName = { family: "Inter", style: "Bold" };

    const textNodeIssue = figma.createText();
    textNodeIssue.characters = `Issue: ${feedback.issue}`;
    textNodeIssue.fontSize = 10;
    textNodeIssue.fontName = { family: "Inter", style: "Regular" };
    textNodeIssue.layoutGrow = 1; // Allow text to wrap
    textNodeIssue.textAutoResize = "HEIGHT";
    textNodeIssue.resize(CARD_WIDTH - 2 * PADDING, textNodeIssue.height); // Resize width first for wrapping

    const textNodeSuggestion = figma.createText();
    textNodeSuggestion.characters = `Suggestion: ${feedback.suggestion}`;
    textNodeSuggestion.fontSize = 10;
    textNodeSuggestion.fontName = { family: "Inter", style: "Regular" };
    textNodeSuggestion.layoutGrow = 1;
    textNodeSuggestion.textAutoResize = "HEIGHT";
    textNodeSuggestion.resize(CARD_WIDTH - 2 * PADDING, textNodeSuggestion.height); // Resize width first

    // Calculate heights after setting text and resizing width
    await figma.clientStorage.setAsync("hack", "force-layout"); // Workaround for height calc
    const issueHeight = textNodeIssue.height;
    const suggestionHeight = textNodeSuggestion.height;
    const heuristicHeight = textNodeHeuristic.height;

    const frame = figma.createFrame();
    frame.name = `Feedback: ${feedback.heuristic.substring(0, 20)}`;
    frame.layoutMode = "VERTICAL";
    frame.paddingTop = PADDING;
    frame.paddingBottom = PADDING;
    frame.paddingLeft = PADDING;
    frame.paddingRight = PADDING;
    frame.itemSpacing = SPACING;
    frame.primaryAxisSizingMode = "AUTO"; // Auto height based on content
    frame.counterAxisSizingMode = "FIXED"; // Fixed width
    frame.fills = [{ type: 'SOLID', color: { r: 1, g: 0.95, b: 0.8 } }]; // Light yellow bg
    frame.strokes = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 } }];
    frame.strokeWeight = 1;
    frame.cornerRadius = 4;
    frame.resize(CARD_WIDTH, 0); // Width set, height is auto

    frame.appendChild(textNodeHeuristic);
    frame.appendChild(textNodeIssue);
    frame.appendChild(textNodeSuggestion);

    // Position the annotation near the target node
    const targetBounds = targetNode.absoluteBoundingBox;
    if (targetBounds) {
        frame.x = targetBounds.x + targetBounds.width + 40; // Position to the right
        frame.y = targetBounds.y;
    }

    figma.currentPage.appendChild(frame);
    return frame;
}

// --- Message Handlers ---

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'analyze') {
    if (!currentSelectedFrame) {
        figma.notify('No valid Frame selected for analysis.', { error: true });
        return;
    }
    figma.notify('Starting analysis... This may take a moment.');

    const componentData = extractComponentData(currentSelectedFrame);

    try {
      const analysisResults = await analyzeComponentWithClaude(componentData, principlesPromptSegment);

      // Send results back to UI, one by one or as a batch
      if (analysisResults && analysisResults.length > 0) {
        // Send results one by one to populate cards incrementally
        analysisResults.forEach(result => {
             figma.ui.postMessage({ type: 'analysis-result', data: result });
        });
         figma.notify(`Analysis complete. ${analysisResults.length} suggestions found.`);
      } else {
         figma.notify('Analysis complete. No specific suggestions found.');
         // Optionally send a message to UI to indicate no results
         figma.ui.postMessage({ type: 'analysis-no-results' });
      }

    } catch (error) {
      console.error('Analysis failed:', error);
      // Notification is already handled in claude.ts for network errors
      // figma.notify('Analysis failed. See console for details.', { error: true });
       figma.ui.postMessage({ type: 'analysis-error', data: { message: error instanceof Error ? error.message : 'Unknown error' } });
    }
  }

  if (msg.type === 'show-on-canvas') {
    if (!currentSelectedFrame) {
        figma.notify('Cannot place annotation, no Frame is selected.', { error: true });
        return;
    }
    const feedback: AnalysisResult = msg.payload;
    console.log('Show on canvas requested', feedback);

    try {
        const annotationNode = await createAnnotation(feedback, currentSelectedFrame);
        figma.viewport.scrollAndZoomIntoView([annotationNode]);
        figma.notify(`Annotation added for: ${feedback.heuristic}`);
    } catch (error) {
        console.error('Failed to create annotation:', error);
        figma.notify('Failed to create annotation on canvas.', { error: true });
    }
  }

  if (msg.type === 'get-initial-selection') {
    updateSelectionInfo(); // Send current selection info when UI loads
  }

  // Remove the old example logic if it exists
  // if (msg.type === 'create-shapes') { ... }
  // if (msg.type === 'cancel') { figma.closePlugin(); }
};

// --- Event Listeners ---

figma.on('selectionchange', () => {
  updateSelectionInfo();
});

// Initial check in case a selection exists when the plugin is opened
updateSelectionInfo();
