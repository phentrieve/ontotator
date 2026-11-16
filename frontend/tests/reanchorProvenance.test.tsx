import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api, type EditorProposal, type ProposalSetView } from '../src/api/client';
import { historical } from './variantFixtures';
import { ProposalMetadataProvider, ProposalSource } from '../src/editor/ProposalSource';
import { AiBadge } from '../src/editor/AiBadge';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const source:EditorProposal = { ...historical.annotations[0], proposal_set_id:4, document_id:'doc', notes:[], annotation:{...historical.annotations[0].annotation, document_id:'doc', provenance:{actor:{actor_id:'ontotator-reanchor',kind:'tool'},method:'reanchor',source_refs:[]}} };
const metadata:ProposalSetView = {id:4, document_id:'doc', annotation_set_id:'carried-set',bundle_id:null,set_kind:'tool_output',actors:[{actor_id:'ontotator-reanchor',kind:'tool',name:'ontotator-reanchor',version:'1'}],origin:'reanchor',source_document_id:'original/id',source_version:7,imported_at:'2026-10-16T00:00:00Z',imported_by_pseudonym:null};
it('uses only inline currently offered metadata without a forbidden ordinary public fetch', () => {
  const get=vi.spyOn(api,'getProposalSet');
  const mounted=render(<ProposalMetadataProvider scope="alice:doc" projectKey="p" proposals={[source]} metadata={[metadata]} allowPublicFetch={false}><ProposalSource source={source}/><AiBadge provenance={source.annotation.provenance} source={source}/></ProposalMetadataProvider>);
  expect(screen.getByText('Carried over from version 7')).toBeTruthy();
  expect(screen.getByText('carried-set')).toBeTruthy(); expect(screen.getByText('AI')).toBeTruthy(); expect(get).not.toHaveBeenCalled();
  mounted.rerender(<ProposalMetadataProvider scope="bob:doc" projectKey="p" proposals={[source]} metadata={[]} allowPublicFetch={false}><ProposalSource source={source}/></ProposalMetadataProvider>);
  expect(screen.queryByText('carried-set')).toBeNull(); expect(get).not.toHaveBeenCalled();
});
const tool = {actor_id:'phentrieve',kind:'tool',name:'phentrieve',version:'1.4.0',model:'bge-m3'};
it('names the tool that produced a re-anchored proposal (#417)', () => {
  const carried:EditorProposal = {...source, annotation:{...source.annotation, provenance:{actor:{actor_id:'phentrieve',kind:'tool'},method:'tool',source_refs:[]}}};
  render(<ProposalMetadataProvider scope="a" projectKey="p" proposals={[carried]} metadata={[{...metadata,actors:[tool]}]} allowPublicFetch={false}><ProposalSource source={carried}/><AiBadge provenance={carried.annotation.provenance} source={carried}/></ProposalMetadataProvider>);
  expect(screen.getByText('Carried over from version 7')).toBeTruthy();
  expect(screen.getAllByText('phentrieve 1.4.0').length).toBeGreaterThan(0);
  expect(screen.getByLabelText('AI-generated: phentrieve 1.4.0')).toBeTruthy();
  expect(document.body.textContent).not.toContain('ontotator-reanchor');
});
it('credits a legacy re-anchored proposal to the tool its set metadata names', () => {
  // Sets re-anchored before #417 name the job; the server resolves their metadata to the source tool.
  render(<ProposalMetadataProvider scope="a" projectKey="p" proposals={[source]} metadata={[{...metadata,actors:[tool]}]} allowPublicFetch={false}><ProposalSource source={source}/><AiBadge provenance={source.annotation.provenance} source={source}/></ProposalMetadataProvider>);
  expect(screen.getByLabelText('AI-generated: phentrieve 1.4.0')).toBeTruthy();
  expect(screen.getAllByText('phentrieve 1.4.0').length).toBeGreaterThan(0);
});
it('does not borrow a tool for a legacy proposal of a set with several tools or of an import', () => {
  const two = [tool, {...tool, actor_id:'other', name:'other'}];
  const mounted = render(<ProposalMetadataProvider scope="a" projectKey="p" proposals={[source]} metadata={[{...metadata,actors:two}]} allowPublicFetch={false}><AiBadge provenance={source.annotation.provenance} source={source}/></ProposalMetadataProvider>);
  expect(screen.getByLabelText('AI-generated: ontotator-reanchor, reanchor')).toBeTruthy();
  mounted.rerender(<ProposalMetadataProvider scope="b" projectKey="p" proposals={[source]} metadata={[{...metadata,origin:'import',source_version:null,source_document_id:null,actors:[tool]}]} allowPublicFetch={false}><AiBadge provenance={source.annotation.provenance} source={source}/></ProposalMetadataProvider>);
  expect(screen.getByLabelText('AI-generated: ontotator-reanchor, reanchor')).toBeTruthy();
});
it('never labels a human adopted annotation AI and does not borrow foreign/unoffered inline metadata', () => {
  const get=vi.spyOn(api,'getProposalSet');
  const human={actor:{actor_id:'alice',kind:'human' as const},method:'manual',source_refs:[`${source.annotation.annotation_id}:${source.version}`]};
  const mounted=render(<ProposalMetadataProvider scope="a" projectKey="p" proposals={[source]} metadata={[metadata]} allowPublicFetch={false}><AiBadge provenance={human} source={source}/><ProposalSource source={source}/></ProposalMetadataProvider>);
  expect(screen.queryByText('AI')).toBeNull(); expect(screen.getByText('Carried over from version 7')).toBeTruthy();
  mounted.rerender(<ProposalMetadataProvider scope="a" projectKey="p" proposals={[source]} metadata={[{...metadata,document_id:'foreign'}]} allowPublicFetch={false}><ProposalSource source={source}/></ProposalMetadataProvider>);
  expect(screen.queryByText('carried-set')).toBeNull(); expect(get).not.toHaveBeenCalled();
});
