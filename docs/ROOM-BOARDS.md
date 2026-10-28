# Room boards

The owner can open **Room boards** inside a job to collect room measurements, design originals and finish annotations. Each save creates a new immutable revision. A board is private to the current installation owner; neither a client assignment nor a link to a selection grants board access.

Upload PDF, PNG, JPEG, GLB or OBJ originals, up to 2 MB each. The built-in PDF viewer opens individual pages. Images open beside revision-specific finish markers. Each original has a download that returns its exact stored bytes, including after later revisions. Additional originals join the next revision; earlier revisions remain available in the revision selector.

GLB version 2 models must contain an embedded buffer and a static scene with triangle primitives. The viewer applies node transforms. OBJ positions and polygon faces become static triangle geometry. Both views support rotation, tilt and zoom, with at most 12000 vertices and 12000 triangles. Materials, textures and animations are not rendered. Skins, morph targets, required extensions, external buffers and unsupported primitives produce a visible unsupported-model result. No model resources are fetched from another host. Unsupported originals remain available to download. IFC and complete model-format coverage remain future work.

Link a reviewed supplier capture and an exact existing selection revision to compare the chosen specification, cost code, supplier cost and client price with the room plan. The board retains those snapshots when supplier prices or selections later change. Updating a board never signs a selection, changes an accepted estimate, revises construction scope or replaces a signed specification. Those remain separate reviewed workflows.

The revision link opens that exact board revision on another device after owner sign-in. It is not an external sharing grant or a complete walkthrough service. Client and subcontractor presentations, external distribution and authorized external design-tool exchange remain unfinished. Room data and originals travel in the private installation archive and obey the job's hold and erasure fences.
