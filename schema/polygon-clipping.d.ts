// NOTE:
// This repo's schema tsconfig uses `baseUrl: "."`, so an import of "polygon-clipping" resolves to this
// file before node_modules. That means this file must fully describe the module's shape.
//
// The polygon-clipping runtime is typically consumed as a default-exported object with methods
// (polygonClipping.union/difference/...), while the upstream .d.ts primarily declares named exports.
// We declare BOTH named exports and a default export for compatibility.

declare module 'polygon-clipping' {
	export type Pair = [number, number]
	export type Ring = Pair[]
	export type Polygon = Ring[]
	export type MultiPolygon = Polygon[]
	export type Geom = Polygon | MultiPolygon

	export function intersection(geom: Geom, ...geoms: Geom[]): MultiPolygon
	export function xor(geom: Geom, ...geoms: Geom[]): MultiPolygon
	export function union(geom: Geom, ...geoms: Geom[]): MultiPolygon
	export function difference(subjectGeom: Geom, ...clipGeoms: Geom[]): MultiPolygon

	const api: {
		intersection: typeof intersection
		xor: typeof xor
		union: typeof union
		difference: typeof difference
	}

	export default api
}
