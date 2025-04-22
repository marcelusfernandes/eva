// Plugin for UI evaluation using Claude API

// Define the expected structure for analysis results
interface AnalysisResult {
  heuristic: string;
  issue: string;
  suggestion: string;
}

// Define the structure for component data
interface LayerData {
  id: string;
  name: string;
  type: string;
  width: number;
  height: number;
  x: number;
  y: number;
  visible: boolean;
  opacity?: number;
  children: LayerData[];
  characters?: string;
  fontSize?: number;
  fontName?: FontName;
  fills?: Paint[];
  strokes?: Paint[];
  layoutMode?: string;
  padding?: { top: number; right: number; bottom: number; left: number };
  itemSpacing?: number;
  constraints?: Constraints;
  layoutAlign?: string;
}

interface ComponentData extends LayerData {
  layoutMode: string;
  childrenCount: number;
  padding?: { top: number; right: number; bottom: number; left: number };
  itemSpacing?: number;
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
const principlesPromptSegment = `You are a UX analysis expert specializing in NNg visual design principles. You will analyze Figma UI components based on their properties and structure.

The component data you'll receive is a Figma mockup that we need to review. It includes:
- Basic properties: width, height, type, name
- Layout information: layoutMode (AUTO_LAYOUT or NONE), padding, itemSpacing
- Children elements with their properties:
  * Position (x, y)
  * Dimensions (width, height)
  * Text content and styling (for text elements)
  * Visual properties (fills, strokes, opacity)
  * Visibility state
  * Hierarchy and nesting

When analyzing, consider:
1. Visual Hierarchy:
   - Size relationships between elements
   - Spacing and positioning
   - Text hierarchy (if present)
   - Use of color and contrast

2. Layout Principles:
   - Proximity between related elements
   - Alignment and distribution
   - Use of padding and margins
   - Responsive behavior (based on AUTO_LAYOUT)

3. Typography (for text elements):
   - Font size appropriateness
   - Text readability
   - Heading vs body text distinction

4. Interactive Elements:
   - Visibility of clickable areas
   - Spacing for touch targets
   - State indicators

5. Accessibility:
   - Color contrast
   - Text size legibility
   - Element spacing for usability

Analyze the component ignoring hidden layers and provide specific, actionable feedback. Focus on concrete issues in the provided component, not generic advice.

Respond ONLY with a JSON array of objects, where each object has:
- 'heuristic': The specific principle being violated
- 'issue': The exact problem found in this component and the layer name only.
- 'suggestion': A specific, implementable solution

Example: [
  {
    "heuristic": "Visual Hierarchy - Text Contrast",
    "issue": "The text element at (x: 24, y: 45) uses a light gray (#CCCCCC) on white background, making it hard to read",
    "suggestion": "Increase the contrast by using a darker gray (at least #666666) for this specific text element"
  }
]`;

// This shows the HTML page in "ui.html".
figma.showUI(__html__, { width: 300, height: 450 }); // Adjust size as needed

let currentSelection: SceneNode | null = null;

// --- Helper Functions ---

function getNodeHierarchy(node: SceneNode): string {
    const path: string[] = [];
    let current: BaseNode | null = node;
    while (current && current.type !== 'PAGE') {
        path.unshift(current.name);
        current = current.parent;
    }
    return path.join(' > ');
}

function extractComponentData(node: SceneNode): ComponentData {
  // Extract children data recursively with better type handling
  const extractLayerData = (node: SceneNode): LayerData => {
    const baseData: LayerData = {
      id: node.id,
      name: node.name,
      type: node.type,
      width: 'width' in node ? node.width : 0,
      height: 'height' in node ? node.height : 0,
      x: node.x,
      y: node.y,
      visible: node.visible,
      children: []  // Initialize empty children array
    };

    // Add opacity if available
    if ('opacity' in node) {
      baseData.opacity = node.opacity;
    }

    // Handle different node types
    switch (node.type) {
      case 'TEXT':
        const textNode = node as TextNode;
        baseData.characters = textNode.characters;
        if (textNode.fontSize !== figma.mixed) {
          baseData.fontSize = textNode.fontSize;
        }
        if (textNode.fontName !== figma.mixed) {
          baseData.fontName = textNode.fontName;
        }
        break;

      case 'FRAME':
      case 'GROUP':
      case 'COMPONENT':
      case 'COMPONENT_SET':
      case 'INSTANCE':
        const containerNode = node as FrameNode | GroupNode | ComponentNode | ComponentSetNode | InstanceNode;
        if ('layoutMode' in containerNode) {
          baseData.layoutMode = containerNode.layoutMode;
          if (containerNode.layoutMode !== "NONE") {
            baseData.padding = {
              top: containerNode.paddingTop,
              right: containerNode.paddingRight,
              bottom: containerNode.paddingBottom,
              left: containerNode.paddingLeft
            };
            baseData.itemSpacing = containerNode.itemSpacing;
          }
        }
        // Recursively process children
        if ('children' in containerNode) {
          baseData.children = containerNode.children.map(child => extractLayerData(child));
        }
        break;
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

    // Add constraints and layout properties if available
    if ('constraints' in node) {
      baseData.constraints = (node as ConstraintMixin).constraints;
    }
    if ('layoutAlign' in node) {
      baseData.layoutAlign = (node as LayoutMixin).layoutAlign;
    }

    return baseData;
  };

  // Start with the node itself
  const baseData = extractLayerData(node);
  
  // Convert to ComponentData
  const componentData: ComponentData = {
    ...baseData,
    layoutMode: 'layoutMode' in node ? (node as FrameNode).layoutMode : 'NONE',
    childrenCount: 'children' in node ? (node as FrameNode).children.length : 0
  };

  // Add layout properties if available
  if ('layoutMode' in node && node.layoutMode !== "NONE") {
    componentData.padding = {
      top: (node as FrameNode).paddingTop,
      right: (node as FrameNode).paddingRight,
      bottom: (node as FrameNode).paddingBottom,
      left: (node as FrameNode).paddingLeft
    };
    componentData.itemSpacing = (node as FrameNode).itemSpacing;
  }

  return componentData;
}

async function getFramePreview(node: SceneNode): Promise<string | null> {
  try {
    // Check if the node is cloneable
    if (!('clone' in node)) {
      console.error('Node type does not support cloning');
      return null;
    }

    // Create a clone of the node
    const clone = node.clone();
    
    // Set max dimensions for the preview
    const MAX_SIZE = 300;
    const scale = Math.min(MAX_SIZE / clone.width, MAX_SIZE / clone.height);
    
    // Export the image
    const bytes = await clone.exportAsync({
      format: 'PNG',
      constraint: {
        type: 'SCALE',
        value: scale
      }
    });

    // Convert to base64
    const base64 = figma.base64Encode(bytes);
    
    // Clean up the clone
    clone.remove();
    
    return `data:image/png;base64,${base64}`;
  } catch (error) {
    console.error('Error generating preview:', error);
    return null;
  }
}

async function updateSelectionInfo() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        currentSelection = null;
        figma.ui.postMessage({ 
          type: 'selection-info', 
          data: { 
            name: 'None', 
            hierarchy: 'N/A',
            preview: null 
          } 
        });
        return;
    }

    if (selection.length > 1) {
        currentSelection = null;
        figma.notify('Please select only one element.', { error: true });
        figma.ui.postMessage({ 
          type: 'selection-info', 
          data: { 
            name: 'Multiple Selected', 
            hierarchy: 'N/A',
            preview: null 
          } 
        });
        return;
    }

    const selectedNode = selection[0];
    currentSelection = selectedNode;
    const hierarchy = getNodeHierarchy(selectedNode);
    const preview = await getFramePreview(selectedNode);
    
    figma.ui.postMessage({ 
      type: 'selection-info', 
      data: { 
        name: selectedNode.name, 
        hierarchy: hierarchy,
        preview: preview 
      } 
    });
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
    if (!currentSelection) {
        figma.notify('No element selected for analysis.', { error: true });
        return;
    }
    figma.notify('Starting analysis... This may take a moment.');

    const componentData = extractComponentData(currentSelection);

    try {
      const analysisResults = await analyzeComponentWithClaude(componentData, principlesPromptSegment);

      if (analysisResults && analysisResults.length > 0) {
        analysisResults.forEach(result => {
             figma.ui.postMessage({ type: 'analysis-result', data: result });
        });
         figma.notify(`Analysis complete. ${analysisResults.length} suggestions found.`);
      } else {
         figma.notify('Analysis complete. No specific suggestions found.');
         figma.ui.postMessage({ type: 'analysis-no-results' });
      }

    } catch (error) {
      console.error('Analysis failed:', error);
      figma.ui.postMessage({ 
        type: 'analysis-error', 
        data: { message: error instanceof Error ? error.message : 'Unknown error' } 
      });
    }
  }

  if (msg.type === 'show-on-canvas') {
    if (!currentSelection) {
        figma.notify('Cannot place annotation, no element is selected.', { error: true });
        return;
    }
    const feedback: AnalysisResult = msg.payload;
    console.log('Show on canvas requested', feedback);

    try {
        const annotationNode = await createAnnotation(feedback, currentSelection);
        figma.viewport.scrollAndZoomIntoView([annotationNode]);
        figma.notify(`Annotation added for: ${feedback.heuristic}`);
    } catch (error) {
        console.error('Failed to create annotation:', error);
        figma.notify('Failed to create annotation on canvas.', { error: true });
    }
  }

  if (msg.type === 'get-initial-selection') {
    updateSelectionInfo();
  }
};

// --- Event Listeners ---

figma.on('selectionchange', () => {
  updateSelectionInfo();
});

// Initial check in case a selection exists when the plugin is opened
updateSelectionInfo();
